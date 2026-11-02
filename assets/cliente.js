// Área da cliente: fazer pedido, ver pedidos, pagar com Pix e avisar o pagamento.
import {
  sb, configurado, NOME_LOJA, TIPOS, $, esc, brl, fmtData, plural, toast, erroTexto, sortDesc,
  itensHTML, totalCartelas, fmtTel, enviarComprovante, abrirComprovante,
  pixCopiaECola, qrDataUrl, copiar
} from './lib.js';
import { montarLogin, mostrarNovaSenha } from './auth.js';

const app = $('#app');
const S = { uid: null, profile: null, cliente: null, config: {}, vendas: [], canal: null, cancelando: null, pagandoUm: null, busy: false };

if (!configurado) {
  app.innerHTML = `<main class="wrap"><div class="notice">O site ainda não está ligado ao banco de dados. Preencha o arquivo <b>assets/config.js</b> com os dados do Supabase (veja o passo a passo no README).</div></main>`;
} else {
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { telaLogin(); mostrarNovaSenha(); return; }
    setTimeout(() => iniciar(session), 0);
  });
}

function telaLogin() {
  S.uid = null;
  if (S.canal) { sb.removeChannel(S.canal); S.canal = null; }
  montarLogin(app, { titulo: NOME_LOJA, sub: 'Entre para pedir seus ovos e acompanhar seus pedidos.' });
}

async function iniciar(session) {
  if (!session) { telaLogin(); return; }
  if (S.uid === session.user.id) return;
  S.uid = session.user.id;
  app.innerHTML = '<p class="wrap empty" style="padding-top:40px">Carregando seus pedidos…</p>';
  try {
    const [p, c, cfg] = await Promise.all([
      sb.from('profiles').select('*').eq('id', S.uid).maybeSingle(),
      sb.from('clientes').select('*').eq('user_id', S.uid).maybeSingle(),
      sb.from('config').select('*').eq('id', 1).maybeSingle()]);
    if (p.error) throw p.error; if (c.error) throw c.error; if (cfg.error) throw cfg.error;
    S.profile = p.data; S.cliente = c.data; S.config = cfg.data || {};
    await carregarVendas();
    montarApp();
    ouvirMudancas();
  } catch (e) {
    app.innerHTML = `<main class="wrap"><div class="notice">${esc(erroTexto(e))}</div><p><button class="btn" onclick="location.reload()">Tentar de novo</button></p></main>`;
  }
}

async function carregarVendas() {
  if (!S.cliente) { S.vendas = []; return; }
  const { data, error } = await sb.from('vendas').select('*').eq('cliente_id', S.cliente.id);
  if (error) throw error;
  S.vendas = (data || []).sort(sortDesc);
}

function ouvirMudancas() {
  if (S.canal || !S.cliente) return;
  S.canal = sb.channel('minhas-vendas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas', filter: `cliente_id=eq.${S.cliente.id}` },
      async () => { try { await carregarVendas(); renderTudo(); } catch (_) { } })
    .subscribe();
}

/* ---------------- tela principal ---------------- */
function montarApp() {
  const nome = (S.cliente?.nome || S.profile?.nome || '').split(' ')[0];
  app.innerHTML = `
  <header><div class="wrap"><div class="bar">
    <a class="brand" href="./"><span class="egg"></span>${esc(NOME_LOJA)}</a>
    <div class="who-bar">${S.profile?.is_admin ? '<a class="btn small yolk" href="admin.html">Área da vendedora</a>' : ''}
      <span>Olá, ${esc(nome || 'cliente')}</span><button type="button" class="linkbtn" id="sair">Sair</button></div>
  </div></div></header>
  <main class="wrap"><section class="view">
    ${!S.cliente ? `<div class="notice">Sua conta ainda está sendo preparada. Se você criou a conta com e-mail e senha, confirme pelo link que enviamos e entre de novo.</div>` : ''}
    ${S.config.aviso_clientes ? `<div class="notice info">${esc(S.config.aviso_clientes)}</div>` : ''}
    <div id="aberto"></div>
    <div id="pedir"></div>
    <div><h3>Meus pedidos</h3><div class="list" id="lista"></div></div>
    <div id="dados"></div>
  </section></main>`;
  $('#sair').addEventListener('click', async () => { await sb.auth.signOut(); });
  if (S.cliente) { montarPedido(); montarDados(); }
  renderTudo();
}

function renderTudo() { renderAberto(); renderLista(); }

const emAberto = () => S.vendas.filter(v => v.status === 'confirmado' && !v.pago);
const pixPronto = () => !!(S.config.pix_chave);

function blocoPix(valor, txid) {
  if (!pixPronto()) return `<p class="hint">Combine a forma de pagamento com a vendedora.</p>`;
  const cod = pixCopiaECola({ chave: S.config.pix_chave, nome: S.config.pix_nome, cidade: S.config.pix_cidade, valor, txid });
  const qr = qrDataUrl(cod);
  return `<div class="pix">${qr ? `<img src="${qr}" alt="QR Code Pix de ${esc(brl(valor))}" width="160" height="160">` : ''}
    <div style="display:grid;gap:8px;min-width:0">
      <span class="hint">Pix de</span><span class="valor num">${brl(valor)}</span>
      <textarea readonly id="pix_${esc(txid)}" aria-label="Código Pix copia e cola">${esc(cod)}</textarea>
      <button type="button" class="btn yolk" data-copiar="pix_${esc(txid)}">Copiar código Pix</button>
      <span class="hint">No app do banco, escolha Pix › "Copia e cola" ou leia o QR Code.</span>
    </div></div>`;
}

function renderAberto() {
  const box = $('#aberto'); if (!box) return;
  const ab = emAberto();
  if (!ab.length) {
    box.innerHTML = S.vendas.some(v => v.status === 'confirmado') ? `<div class="okbox"><b>Tudo pago. Obrigada!</b><span class="hint">Você não tem nada em aberto.</span></div>` : '';
    return;
  }
  const total = ab.reduce((s, v) => s + Number(v.valor || 0), 0);
  const faltaAvisar = ab.filter(v => !v.pagamento_informado_em);
  box.innerHTML = `
    <div style="display:grid;gap:14px">
      <div class="owed-head"><h3 style="margin:0">Para pagar</h3><span class="owed-total num">${brl(total)}</span></div>
      <p class="hint" style="margin:0">${ab.length} ${plural(ab.length, 'pedido', 'pedidos')} em aberto: ${ab.map(v => `${fmtData(v.data)} (${brl(v.valor)})`).join(', ')}.</p>
      ${blocoPix(total, 'FRANCIEGG')}
      ${faltaAvisar.length ? `
      <div class="panel">
        <b>Já pagou? Avise a vendedora</b>
        <div class="field"><label for="compTodos">Comprovante (opcional)</label><input type="file" id="compTodos" accept="image/*,application/pdf"></div>
        <button type="button" class="btn" id="avisarTodos">Avisar que paguei ${brl(faltaAvisar.reduce((s, v) => s + Number(v.valor || 0), 0))}</button>
      </div>` : `<div class="notice info">Você avisou o pagamento. A vendedora vai conferir e marcar como pago.</div>`}
    </div>`;
  const b = $('#avisarTodos');
  if (b) b.addEventListener('click', () => avisarPagamento(faltaAvisar, $('#compTodos'), b));
}

async function avisarPagamento(vendas, input, btn) {
  if (S.busy) return; S.busy = true; btn.disabled = true; const txt = btn.textContent;
  try {
    let path = null; const f = input?.files?.[0];
    if (f) { btn.textContent = 'Enviando comprovante…'; path = await enviarComprovante(f, S.uid); }
    btn.textContent = 'Avisando…';
    for (const v of vendas) {
      const { error } = await sb.rpc('informar_pagamento', { p_id: v.id, p_path: path });
      if (error) throw error;
    }
    toast('Pronto! A vendedora foi avisada do pagamento.');
    S.pagandoUm = null; await carregarVendas(); renderTudo();
  } catch (e) { toast(erroTexto(e)); btn.textContent = txt; }
  finally { S.busy = false; btn.disabled = false; }
}

function statusPill(v) {
  if (v.status === 'pedido') return '<span class="pill info">Aguardando confirmação</span>';
  if (v.status === 'cancelado') return '<span class="pill mute">Cancelado</span>';
  if (v.pago) return '<span class="pill ok">Pago</span>';
  if (v.pagamento_informado_em) return '<span class="pill info">Pagamento avisado</span>';
  return '<span class="pill pend">A pagar</span>';
}

function renderLista() {
  const box = $('#lista'); if (!box) return;
  if (!S.vendas.length) { box.innerHTML = '<p class="empty">Você ainda não tem pedidos. Faça o primeiro acima.</p>'; return; }
  box.innerHTML = S.vendas.map(v => {
    const id = esc(v.id);
    let acts = '';
    if (v.status === 'pedido' && S.cancelando !== v.id) acts += `<button type="button" class="linkbtn" data-act="cancelar" data-id="${id}">Cancelar pedido</button>`;
    if (v.status === 'confirmado' && !v.pago && !v.pagamento_informado_em && S.pagandoUm !== v.id) acts += `<button type="button" class="btn small" data-act="pagarUm" data-id="${id}">Pagar este pedido</button>`;
    if (v.comprovante_path) acts += `<button type="button" class="btn small ghost" data-act="comp" data-id="${id}">Ver comprovante</button>`;
    const conf = S.cancelando === v.id ? `<div class="confirm"><span>Cancelar este pedido?</span><div class="actions">
      <button type="button" class="btn small danger" data-act="cancelarSim" data-id="${id}">Sim, cancelar</button>
      <button type="button" class="btn small ghost" data-act="cancelarNao">Voltar</button></div></div>` : '';
    const pagar = S.pagandoUm === v.id ? `<div class="panel">${blocoPix(Number(v.valor), String(v.id).replace(/-/g, '').slice(0, 12))}
      <div class="field"><label for="comp_${id}">Comprovante (opcional)</label><input type="file" id="comp_${id}" accept="image/*,application/pdf"></div>
      <div class="actions"><button type="button" class="btn" data-act="avisarUm" data-id="${id}">Avisar que paguei</button>
      <button type="button" class="btn ghost" data-act="pagarNao">Fechar</button></div></div>` : '';
    return `<article class="card ${v.status === 'confirmado' && !v.pago ? 'pendente' : v.status === 'pedido' ? 'novo' : ''}">
      <div class="ctop"><strong class="num">${fmtData(v.data)} · ${totalCartelas(v)} ${plural(totalCartelas(v), 'cartela', 'cartelas')}</strong>${statusPill(v)}</div>
      <div class="items">${itensHTML(v)}</div>
      <div class="meta num"><span class="val">${brl(v.valor)}</span>${v.pago && v.pago_em ? `<span>Pago em ${fmtData(v.pago_em)}</span>` : ''}${v.pagamento_informado_em && !v.pago ? `<span>Avisado em ${fmtData(v.pagamento_informado_em)}</span>` : ''}</div>
      ${v.obs ? `<div class="obs">${esc(v.obs)}</div>` : ''}
      ${acts ? `<div class="actions">${acts}</div>` : ''}${conf}${pagar}
    </article>`;
  }).join('');
}

app.addEventListener('click', async e => {
  const cp = e.target.closest('[data-copiar]');
  if (cp) { const ta = document.getElementById(cp.dataset.copiar); copiar(ta.value, ta); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const v = S.vendas.find(x => x.id === b.dataset.id), act = b.dataset.act;
  if (act === 'cancelar') { S.cancelando = v.id; renderLista(); }
  else if (act === 'cancelarNao') { S.cancelando = null; renderLista(); }
  else if (act === 'pagarUm') { S.pagandoUm = v.id; renderLista(); }
  else if (act === 'pagarNao') { S.pagandoUm = null; renderLista(); }
  else if (act === 'comp') abrirComprovante(v.comprovante_path);
  else if (act === 'avisarUm') avisarPagamento([v], document.getElementById('comp_' + v.id), b);
  else if (act === 'cancelarSim') {
    const { error } = await sb.rpc('cancelar_pedido', { p_id: v.id });
    if (error) { toast(erroTexto(error)); return; }
    S.cancelando = null; toast('Pedido cancelado.'); await carregarVendas(); renderTudo();
  }
});

/* ---------------- fazer pedido ---------------- */
function montarPedido() {
  const box = $('#pedir'), c = S.config;
  if (!c.aceitando_pedidos) {
    box.innerHTML = `<div><h3>Fazer pedido</h3><div class="notice">Os pedidos pelo site estão pausados no momento. Fale direto com a vendedora.</div></div>`;
    return;
  }
  const tipos = TIPOS.filter(t => c['preco_' + t.k] != null);
  if (!tipos.length) { box.innerHTML = `<div><h3>Fazer pedido</h3><p class="empty">Os preços ainda não foram cadastrados. Volte mais tarde.</p></div>`; return; }
  box.innerHTML = `<div><h3>Fazer pedido</h3>
    <form id="fPedido" novalidate>
      <div class="qty">${tipos.map(t => `<div class="qrow"><div class="tn"><span class="egg dot-${t.k}" style="width:16px;height:20px"></span>
        <div><strong>${t.n}</strong><span>${brl(c['preco_' + t.k])} a cartela</span></div></div>
        <div class="step"><button type="button" data-step="-1" data-t="${t.k}" aria-label="Menos ${t.n}">−</button>
        <input type="number" id="q_${t.k}" min="0" max="60" step="1" value="0" inputmode="numeric" aria-label="Cartelas de ${t.n}">
        <button type="button" data-step="1" data-t="${t.k}" aria-label="Mais ${t.n}">+</button></div></div>`).join('')}</div>
      <div class="summary" id="pTotal">Escolha as cartelas.</div>
      <div class="field"><label for="pObs">Observação (opcional)</label><input type="text" id="pObs" maxlength="300" placeholder="Ex.: entregar sábado de manhã"></div>
      <button type="submit" class="btn yolk" id="pEnviar">Enviar pedido</button>
      <p class="hint" style="margin:0">A vendedora confirma o pedido. Você acompanha tudo em "Meus pedidos".</p>
    </form></div>`;
  const qtd = () => Object.fromEntries(TIPOS.map(t => [t.k, Math.max(0, Math.floor(Number(document.getElementById('q_' + t.k)?.value) || 0))]));
  const atualizar = () => {
    const q = qtd(), n = totalCartelas(q), tot = TIPOS.reduce((s, t) => s + q[t.k] * (Number(c['preco_' + t.k]) || 0), 0);
    $('#pTotal').innerHTML = n ? `${n} ${plural(n, 'cartela', 'cartelas')} · Total <b class="num">${brl(tot)}</b>` : 'Escolha as cartelas.';
  };
  box.addEventListener('click', e => {
    const s = e.target.closest('[data-step]'); if (!s) return;
    const i = document.getElementById('q_' + s.dataset.t); i.value = Math.max(0, Math.min(60, (Math.floor(Number(i.value) || 0)) + Number(s.dataset.step))); atualizar();
  });
  box.addEventListener('input', atualizar);
  $('#fPedido').addEventListener('submit', async e => {
    e.preventDefault(); if (S.busy) return;
    const q = qtd(); if (!totalCartelas(q)) { toast('Escolha pelo menos 1 cartela.'); return; }
    const btn = $('#pEnviar'); S.busy = true; btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const { error } = await sb.rpc('fazer_pedido', { p_extra: q.extra, p_jumbo: q.jumbo, p_vermelho: q.vermelho, p_obs: $('#pObs').value });
      if (error) throw error;
      TIPOS.forEach(t => { const i = document.getElementById('q_' + t.k); if (i) i.value = 0; }); $('#pObs').value = ''; atualizar();
      toast('Pedido enviado! Você vê a confirmação em "Meus pedidos".');
      await carregarVendas(); renderTudo();
    } catch (err) { toast(erroTexto(err)); }
    finally { S.busy = false; btn.disabled = false; btn.textContent = 'Enviar pedido'; }
  });
}

/* ---------------- meus dados ---------------- */
function montarDados() {
  $('#dados').innerHTML = `<div><h3>Meus dados</h3>
    <form id="fDados" novalidate>
      <div class="two">
        <div class="field"><label for="dNome">Nome</label><input type="text" id="dNome" value="${esc(S.cliente.nome || '')}" autocomplete="name"></div>
        <div class="field"><label for="dTel">WhatsApp</label><input type="tel" id="dTel" inputmode="tel" value="${esc(fmtTel(S.cliente.telefone))}" placeholder="(11) 99999-9999"></div>
      </div>
      <div><button type="submit" class="btn ghost">Salvar meus dados</button></div>
    </form></div>`;
  $('#fDados').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.rpc('atualizar_meus_dados', { p_nome: $('#dNome').value, p_telefone: $('#dTel').value });
    if (error) { toast(erroTexto(error)); return; }
    toast('Dados salvos.');
  });
}
