# FranciEgg

Site de venda de ovos com duas áreas:

- **Site da cliente** (`index.html`): a cliente entra com Google ou e-mail e senha, faz pedidos, vê "Meus pedidos", vê quanto tem em aberto e paga com Pix (QR Code e copia e cola já com o valor). Depois ela avisa que pagou, com comprovante se quiser.
- **Área da vendedora** (`admin.html`): estoque, pedidos novos (confirmar ou recusar), vendas feitas pessoalmente, quem falta pagar, pagamentos avisados, gráficos, WhatsApp, clientes, Pix, preços e exportação/importação em CSV.

Tudo roda de graça: **Supabase** (banco, login e comprovantes) e **Vercel** (o site). Não precisa de Docker nem de servidor.

---

## Passo a passo (uns 20 a 30 minutos)

### 1. Criar o banco no Supabase

1. Entre em <https://supabase.com> e crie uma conta (dá para usar o GitHub).
2. **New project**. Nome: `franciegg`. Região: **South America (São Paulo)**. Crie e guarde a senha do banco.
3. Quando o projeto terminar de criar, abra **SQL Editor → New query**.
4. Copie **todo** o conteúdo de [`supabase/schema.sql`](supabase/schema.sql), cole e clique em **Run**. Deve aparecer "Success".

### 2. Ligar o site ao banco

1. No Supabase: **Project Settings → API**. Copie a **Project URL** (só o endereço, terminando em `.supabase.co`, sem `/rest/v1`) e a chave **anon public**.
2. Aqui no GitHub, abra [`assets/config.js`](assets/config.js), clique no lápis (editar), cole os dois valores no lugar indicado e clique em **Commit changes**.

> A chave `anon` é pública de propósito. Quem protege os dados são as regras do banco. **Nunca** coloque a chave `service_role` no site.

### 3. Publicar o site na Vercel

1. Entre em <https://vercel.com> com a sua conta do GitHub.
2. **Add New → Project** e escolha o repositório `franciegg`.
3. Em *Framework Preset*, deixe **Other**. Não precisa de comando de build. Clique em **Deploy**.
4. Anote o endereço que a Vercel der (algo como `https://franciegg.vercel.app`). Toda vez que o código mudar no GitHub, a Vercel publica sozinha.

### 4. Dizer ao Supabase qual é o endereço do site

No Supabase: **Authentication → URL Configuration**

- **Site URL**: o endereço da Vercel (ex.: `https://franciegg.vercel.app`)
- **Redirect URLs**: adicione `https://franciegg.vercel.app/**` (troque pelo seu endereço)

Sem isso, o login com Google e os links de confirmação de e-mail não voltam para o site.

### 5. Login com e-mail e senha

Já vem ligado. Em **Authentication → Sign In / Providers → Email**, deixe **Confirm email** ligado: assim ninguém cria conta com o e-mail de outra pessoa.

> O envio de e-mail que vem com o Supabase é bem limitado (poucos e-mails por hora). Para começar, dá conta. Se muitas clientes se cadastrarem no mesmo dia, configure um SMTP gratuito (Resend ou Brevo) em **Authentication → Emails → SMTP Settings**.

### 6. Login com Google

1. Entre em <https://console.cloud.google.com> e crie um projeto (`FranciEgg`).
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**. Preencha o nome do app (`FranciEgg`) e o seu e-mail. Depois clique em **Publicar app**; se ficar em "teste", só os e-mails cadastrados como testadores conseguem entrar.
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
4. Em **URIs de redirecionamento autorizados**, cole a *Callback URL* que aparece no Supabase em **Authentication → Sign In / Providers → Google** (é algo como `https://SEU-PROJETO.supabase.co/auth/v1/callback`).
5. Copie o **ID do cliente** e a **Chave secreta** e cole no Supabase, na mesma tela do Google. Ative e salve.

### 7. Transformar a conta da sua mãe em administradora

1. Sua mãe abre o site e cria a conta dela (Google ou e-mail e senha).
2. No Supabase, em **SQL Editor**, rode (trocando o e-mail):

   ```sql
   update public.profiles set is_admin = true where email = 'email.da.sua.mae@gmail.com';
   ```

3. Ela abre `https://SEU-SITE.vercel.app/admin.html`. Vale salvar esse link na tela inicial do celular dela.

### 8. Primeiros ajustes (na área da vendedora → Ajustes)

- **Preços da cartela.** Tipo sem preço não aparece para as clientes.
- **Pix**: tipo de chave, chave, nome e cidade. Faça um pedido de teste de R$ 1 e pague para conferir.
- **Recado para as clientes** (opcional), por exemplo os dias de entrega.
- Copie o **link para divulgar** e mande para as clientes.

### 9. Trazer os dados do FranciEgg antigo (opcional)

1. No FranciEgg antigo, use **Exportar todas as vendas (CSV)** e **Exportar compras (CSV)**.
2. No novo: **Ajustes → Dados → Trazer dados do FranciEgg antigo**. Escolha um arquivo de cada vez e confirme.
3. Importe cada arquivo **uma vez só**. Os comprovantes antigos não vêm junto; as vendas que tinham comprovante ficam marcadas na observação.
4. Para que uma cliente antiga veja o histórico dela quando criar conta, coloque o e-mail dela em **Ajustes → Clientes** antes de ela se cadastrar.

---

## Como funciona

**Pedido pelo site.** A cliente pede e o pedido chega como **Pedido novo**: aparece um aviso no Painel e um número vermelho na aba Vendas. A vendedora **confirma** (as cartelas saem do estoque e o valor vai para "a receber") ou **recusa**.

**Pagamento.** A cliente vê o total em aberto com o Pix pronto. Depois de pagar, toca em **Avisar que paguei**, com comprovante se quiser. A vendedora vê "Cliente avisou que pagou", confere no banco e marca como pago. Ninguém precisa cobrar ninguém.

**Venda pessoal.** Pela aba **Vender**, como antes. Se a cliente tiver conta, a venda aparece para ela também.

**WhatsApp.** Os botões abrem o WhatsApp com a mensagem pronta. As mensagens são editáveis em Ajustes; `{link}` coloca o endereço do site, onde a cliente vê e paga.

**Segurança.** As regras ficam no banco (Row Level Security): cada cliente só enxerga os próprios pedidos e dados, não consegue marcar nada como pago nem mexer em preço, e só a administradora vê tudo. Os comprovantes ficam num armazenamento privado.

---

## Limites do plano gratuito

| Serviço | O que vale saber |
|---|---|
| Supabase | 500 MB de banco, 1 GB para comprovantes, até 50 mil usuários por mês. **O projeto pausa depois de 1 semana sem nenhum acesso**; se acontecer, entre no painel do Supabase e clique em *Restore*. Nenhum dado é perdido. |
| Vercel | Sobra para um site deste tamanho. |
| E-mails do Supabase | Poucos por hora (veja o passo 5). |

Cada comprovante tem no máximo 5 MB, e as fotos são reduzidas antes do envio.

## Privacidade (LGPD)

O site guarda nome, e-mail e telefone das clientes e os pedidos delas. Use esses dados só para as vendas. Se alguma cliente pedir para sair, apague a conta em **Authentication → Users** e os dados dela em **Ajustes → Clientes** (ou pelo SQL Editor).

## Arquivos

```
index.html          site da cliente
admin.html          área da vendedora
assets/config.js    endereço e chave do Supabase (preencher)
assets/base.css     visual
assets/lib.js       funções comuns (Pix, datas, comprovantes…)
assets/auth.js      tela de login
assets/cliente.js   lógica do site da cliente
assets/admin.js     lógica da área da vendedora
supabase/schema.sql banco de dados e regras de acesso
```

Não há etapa de build. Para testar no computador, rode `npx serve .` dentro da pasta e adicione `http://localhost:3000/**` nas Redirect URLs do Supabase.
