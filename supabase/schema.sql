-- =====================================================================
--  FranciEgg — banco de dados (Supabase / Postgres)
--  Rode este arquivo INTEIRO uma única vez no "SQL Editor" do Supabase.
--  Depois, no fim do arquivo, tem o comando para transformar a conta da
--  sua mãe em administradora.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Uma linha por conta que faz login (clientes e a administradora).
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nome        text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Clientes. Pode existir sem conta (amiga que só compra pessoalmente);
-- quando ela criar uma conta com o mesmo e-mail, as duas coisas se ligam.
create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  telefone    text,
  email       text,
  user_id     uuid unique references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index clientes_email_idx on public.clientes (lower(email));

-- Configurações gerais (sempre uma linha só, id = 1).
create table public.config (
  id                 int primary key default 1 check (id = 1),
  preco_extra        numeric(10,2),
  preco_jumbo        numeric(10,2),
  preco_vermelho     numeric(10,2),
  pix_tipo           text check (pix_tipo in ('cpf','celular','email','aleatoria')),
  pix_chave          text,
  pix_nome           text,
  pix_cidade         text,
  msg_pedido         text,
  msg_lembrete       text,
  aceitando_pedidos  boolean not null default true,
  aviso_clientes     text,
  updated_at         timestamptz not null default now()
);
insert into public.config (id) values (1);

-- Entradas no estoque (compras da distribuidora). Unidade: cartela.
create table public.compras (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('extra','jumbo','vermelho')),
  formato     text not null check (formato in ('caixa','meia','cartela','personalizado')),
  qtd         int  not null check (qtd > 0),
  cartelas    int  not null check (cartelas > 0),
  valor       numeric(10,2),
  data        date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  created_at  timestamptz not null default now()
);

-- Vendas e pedidos.
--   status 'pedido'     = a cliente pediu pelo site e a vendedora ainda não confirmou
--   status 'confirmado' = venda feita (só esta sai do estoque e entra em "a receber")
--   status 'cancelado'  = desistência ou recusa
create table public.vendas (
  id                      uuid primary key default gen_random_uuid(),
  cliente_id              uuid not null references public.clientes(id) on delete restrict,
  data                    date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  extra                   int  not null default 0 check (extra >= 0),
  jumbo                   int  not null default 0 check (jumbo >= 0),
  vermelho                int  not null default 0 check (vermelho >= 0),
  valor                   numeric(10,2) not null default 0 check (valor >= 0),
  status                  text not null default 'confirmado' check (status in ('pedido','confirmado','cancelado')),
  origem                  text not null default 'admin' check (origem in ('admin','cliente')),
  pago                    boolean not null default false,
  forma                   text,
  pago_em                 date,
  pagamento_informado_em  timestamptz,
  comprovante_path        text,
  obs                     text,
  created_at              timestamptz not null default now(),
  constraint vendas_tem_itens check (extra + jumbo + vermelho > 0)
);
create index vendas_cliente_idx on public.vendas (cliente_id);
create index vendas_data_idx on public.vendas (data);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.minha_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clientes c where c.user_id = auth.uid() limit 1
$$;

-- Cria o perfil quando alguém se cadastra e liga a conta a uma cliente.
-- A ligação por e-mail só acontece com e-mail confirmado (Google já vem
-- confirmado; e-mail e senha, depois do clique no link de confirmação).
create or replace function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nome    text;
  v_cliente uuid;
begin
  v_nome := coalesce(
    nullif(trim(new.raw_user_meta_data->>'nome'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1));

  insert into public.profiles (id, email, nome) values (new.id, new.email, v_nome)
  on conflict (id) do update set email = excluded.email;

  if new.email_confirmed_at is null then
    return new;
  end if;

  begin
    if not exists (select 1 from public.clientes where user_id = new.id) then
      select id into v_cliente from public.clientes
       where user_id is null and email is not null and lower(email) = lower(new.email)
       order by created_at limit 1;
      if v_cliente is not null then
        update public.clientes set user_id = new.id where id = v_cliente;
      else
        insert into public.clientes (nome, email, telefone, user_id)
        values (v_nome, new.email,
                nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone',''), '\D', '', 'g'), ''),
                new.id);
      end if;
    end if;
  exception when others then
    -- nunca impedir o cadastro por causa disso
    raise warning 'FranciEgg: não foi possível ligar a cliente: %', sqlerrm;
  end;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user();

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_auth_user();

-- ---------------------------------------------------------------------
-- Ações que a cliente pode fazer (validadas aqui no banco)
-- ---------------------------------------------------------------------

create or replace function public.fazer_pedido(p_extra int, p_jumbo int, p_vermelho int, p_obs text default null)
returns public.vendas language plpgsql security definer set search_path = public as $$
declare
  c     public.config;
  v_cli uuid;
  v     public.vendas;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para fazer pedidos.';
  end if;
  select * into c from public.config where id = 1;
  if not c.aceitando_pedidos then
    raise exception 'Os pedidos pelo site estão pausados no momento.';
  end if;

  p_extra := coalesce(p_extra, 0); p_jumbo := coalesce(p_jumbo, 0); p_vermelho := coalesce(p_vermelho, 0);
  if p_extra < 0 or p_jumbo < 0 or p_vermelho < 0 or p_extra + p_jumbo + p_vermelho = 0 then
    raise exception 'Escolha pelo menos 1 cartela.';
  end if;
  if p_extra + p_jumbo + p_vermelho > 60 then
    raise exception 'Para pedidos acima de 60 cartelas, fale direto com a vendedora.';
  end if;
  if (p_extra > 0 and c.preco_extra is null) or (p_jumbo > 0 and c.preco_jumbo is null)
     or (p_vermelho > 0 and c.preco_vermelho is null) then
    raise exception 'Um dos tipos escolhidos ainda está sem preço. Fale com a vendedora.';
  end if;

  v_cli := public.minha_cliente_id();
  if v_cli is null then
    raise exception 'Confirme seu e-mail antes de fazer pedidos.';
  end if;
  if (select count(*) from public.vendas where cliente_id = v_cli and status = 'pedido') >= 5 then
    raise exception 'Você já tem 5 pedidos esperando confirmação. Aguarde a vendedora confirmar.';
  end if;

  insert into public.vendas (cliente_id, extra, jumbo, vermelho, valor, status, origem, obs)
  values (v_cli, p_extra, p_jumbo, p_vermelho,
          coalesce(p_extra * c.preco_extra, 0) + coalesce(p_jumbo * c.preco_jumbo, 0) + coalesce(p_vermelho * c.preco_vermelho, 0),
          'pedido', 'cliente', left(nullif(trim(p_obs), ''), 300))
  returning * into v;
  return v;
end $$;

create or replace function public.cancelar_pedido(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.vendas set status = 'cancelado'
   where id = p_id and status = 'pedido' and cliente_id = public.minha_cliente_id();
  if not found then
    raise exception 'Esse pedido já foi confirmado e não pode ser cancelado por aqui.';
  end if;
end $$;

-- A cliente avisa que pagou (com ou sem comprovante). Quem marca "pago"
-- de verdade é a vendedora, depois de conferir.
create or replace function public.informar_pagamento(p_id uuid, p_path text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'Arquivo de comprovante inválido.';
  end if;
  update public.vendas
     set pagamento_informado_em = now(),
         comprovante_path = coalesce(p_path, comprovante_path)
   where id = p_id and cliente_id = public.minha_cliente_id()
     and status <> 'cancelado' and not pago;
  if not found then
    raise exception 'Não deu para avisar o pagamento desse pedido.';
  end if;
end $$;

create or replace function public.atualizar_meus_dados(p_nome text, p_telefone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.clientes
     set nome = coalesce(nullif(trim(p_nome), ''), nome),
         telefone = nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '')
   where user_id = auth.uid();
  update public.profiles set nome = coalesce(nullif(trim(p_nome), ''), nome) where id = auth.uid();
end $$;

revoke all on function public.fazer_pedido(int,int,int,text)      from public, anon;
revoke all on function public.cancelar_pedido(uuid)               from public, anon;
revoke all on function public.informar_pagamento(uuid,text)       from public, anon;
revoke all on function public.atualizar_meus_dados(text,text)     from public, anon;
grant execute on function public.fazer_pedido(int,int,int,text)   to authenticated;
grant execute on function public.cancelar_pedido(uuid)            to authenticated;
grant execute on function public.informar_pagamento(uuid,text)    to authenticated;
grant execute on function public.atualizar_meus_dados(text,text)  to authenticated;

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
--   * a administradora vê e altera tudo
--   * cada cliente vê só os próprios dados e pedidos
--   * clientes não alteram tabelas direto; usam as funções acima
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.clientes enable row level security;
alter table public.config   enable row level security;
alter table public.compras  enable row level security;
alter table public.vendas   enable row level security;

create policy "perfis: ver o próprio, admin vê todos" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "perfis: só admin altera" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "clientes: admin faz tudo" on public.clientes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "clientes: cada uma vê a própria" on public.clientes
  for select to authenticated using (user_id = auth.uid());

create policy "config: quem está logado lê" on public.config
  for select to authenticated using (true);
create policy "config: só admin altera" on public.config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "compras: só admin" on public.compras
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "vendas: admin faz tudo" on public.vendas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "vendas: cliente vê as próprias" on public.vendas
  for select to authenticated using (cliente_id = public.minha_cliente_id());

-- ---------------------------------------------------------------------
-- Comprovantes (Supabase Storage, bucket privado, até 5 MB por arquivo)
-- Cada cliente envia na pasta com o próprio id; a admin vê todas.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "comprovantes: enviar na própria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes'
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "comprovantes: ver os próprios, admin vê todos" on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "comprovantes: só admin apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprovantes' and public.is_admin());

-- ---------------------------------------------------------------------
-- Tempo real: a tela da administradora recebe pedidos novos na hora.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.vendas;

-- =====================================================================
--  DEPOIS que sua mãe criar a conta dela no site, rode só esta linha
--  (trocando o e-mail) para ela virar administradora:
--
--  update public.profiles set is_admin = true where email = 'EMAIL_DA_SUA_MAE@gmail.com';
-- =====================================================================
