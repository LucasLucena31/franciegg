// Área da vendedora: estoque, pedidos, vendas, recebimentos, gráficos, WhatsApp e ajustes.
import {
  sb, configurado, TIPOS, FORMATOS, $, esc, brl, moneyField, parseMoney, hoje, fmtData, keyNome, plural,
  tipoNome, formatoNome, totalCartelas, sortDesc, itensTexto, itensHTML, soDigitos, telWa, fmtTel,
  toast, erroTexto, enviarComprovante, abrirComprovante, normalizarChavePix
} from './lib.js';
import { montarLogin, mostrarNovaSenha } from './auth.js';

const POUCO = 3;
const LINK_SITE = location.origin + location.pathname.replace(/admin\.html$/, '');
const MSG_PADRAO = {
  pedido: 'Olá! Seu pedido de ovos foi registrado: {pedido}. Obrigada! 🥚',
  lembrete: 'Olá! Passando para lembrar do pagamento do seu pedido: {pedido}. Você pode ver e pagar pelo Pix aqui: {link} 🥚'
};

const S = {
  uid: null, config: {}, clientes: [], compras: [], vendas: [], ready: false, busy: false,
  filtro: 'pendentes', busca: '', payOpen: null, delOpen: null, recusarOpen: null, delCompra: null, recemConfirmado: null,
  valorManual: false, msgDirty: false, dPer: { k: '3m', de: '', ate: '' }, lPer: { k: 'tudo', de: '', ate: '' }, canal: null
};
const cliPorId = id => S.clientes.find(c => c.id === id) || { nome: '(cliente removida)' };
const nomeDe = v => cliPorId(v.cliente_id).nome;
const confirmadas = () => S.vendas.filter(v => v.status === 'confirmado');

/* =================== início e login =================== */
if (!configurado) {
  document.querySelectorAll('#app,#login,#semAcesso').forEach(x => x.remove());
  document.body.insertAdjacentHTML('afterbegin', `<main class="wrap" style="padding-top:30px"><div class="notice">O site ainda não está ligado ao banco de dados. Preencha <b>assets/config.js</b> (veja o README).</div></main>`);
  throw new Error('FranciEgg: config.js não preenchido');
  document.body.innerHTML = `<main class="wrap" style="padding-top:30px"><div class="notice">O site ainda não está ligado ao banco de dados. Preencha <b>assets/config.js</b> (veja o README).</div></main>`;
} else {
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { mostrar('login'); montarLogin($('#login'), { titulo: 'Área da vendedora', sub: '' }); mostrarNovaSenha(); return; }
    setTimeout(() => iniciar(session), 0);
  });
}
function mostrar(qual) { ['login', 'semAcesso', 'app'].forEach(id => $('#' + id).hidden = id !== qual); }

async function iniciar(session) {
  if (!session) {
    S.uid = null; if (S.canal) { sb.removeChannel(S.canal); S.canal = null; }
    mostrar('login'); montarLogin($('#login'), { titulo: 'Área da vendedora', sub: 'Entre com a conta de administradora.' });
    return;
  }
  if (S.uid === session.user.id) return;
  S.uid = session.user.id;
  const { data: p, error } = await sb.from('profiles').select('is_admin,nome').eq('id', S.uid).maybeSingle();
  if (error || !p?.is_admin) {
    mostrar('semAcesso');
    $('#semAcesso').innerHTML = `<main class="wrap" style="padding-top:30px;display:grid;gap:14px">
      <div class="notice">Esta conta (${esc(session.user.email || '')}) não é de administradora. Se é a conta da vendedora, siga o passo "Virar administradora" do README.</div>
      <div class="actions"><a class="btn" href="./">Ir para o site da cliente</a><button type="button" class="btn ghost" id="sair2">Sair</button></div></main>`;
    $('#sair2').addEventListener('click', () => sb.auth.signOut());
    return;
  }
  mostrar('app');
  await carregar();
  ouvir();
}
$('#sair').addEventListener('click', () => sb.auth.signOut());

async function buscarTudo(tabela) {
  const out = []; let de = 0;
  for (;;) {
    const { data, error } = await sb.from(tabela).select('*').range(de, de + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break; de += 1000;
  }
  return out;
}
async function carregar() {
  try {
    const [cfg, cli, com, ven] = await Promise.all([
      sb.from('config').select('*').eq('id', 1).single(), buscarTudo('clientes'), buscarTudo('compras'), buscarTudo('vendas')]);
    if (cfg.error) throw cfg.error;
    S.config = cfg.data || {}; S.clientes = cli; S.compras = com; S.vendas = ven; S.ready = true;
    notice(null); renderAll();
  } catch (e) { notice('Não consegui carregar os dados: ' + erroTexto(e)); }
}
let recT = null;
const recarregar = () => { clearTimeout(recT); recT = setTimeout(carregar, 300); };
function ouvir() {
  if (S.canal) return;
  S.canal = sb.channel('admin')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, p => {
      if (p.eventType === 'INSERT' && p.new?.status === 'pedido') toast('Chegou um pedido novo pelo site!');
      if (p.eventType === 'UPDATE' && p.new?.pagamento_informado_em && !p.old?.pagamento_informado_em) toast('Uma cliente avisou que pagou.');
      recarregar();
    }).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recarregar(); });
}

function notice(msg) { const n = $('#notice'); n.hidden = !msg; n.textContent = msg || ''; }

/* =================== escrita no banco =================== */
async function salvar(promessa, ok) {
  const { error } = await promessa;
  if (error) throw error;
  if (ok) toast(ok);
  await carregar();
}
async function clienteIdPorNome(nome, tel) {
  const k = keyNome(nome);
  let c = S.clientes.find(x => keyNome(x.nome) === k && x.user_id !== S.uid);
  const t = soDigitos(tel);
  if (!c) {
    const { data, error } = await sb.from('clientes').insert({ nome: nome.trim(), telefone: t || null }).select().single();
    if (error) throw error; S.clientes.push(data); return data.id;
  }
  if (t && t !== soDigitos(c.telefone)) { const { error } = await sb.from('clientes').update({ telefone: t }).eq('id', c.id); if (error) throw error; c.telefone = t; }
  return c.id;
}

/* =================== estoque e painel =================== */
function estoque() {
  const e = { extra: 0, jumbo: 0, vermelho: 0 }, r = { extra: 0, jumbo: 0, vermelho: 0 };
  S.compras.forEach(c => { if (e[c.tipo] != null) e[c.tipo] += Number(c.cartelas) || 0; });
  S.vendas.forEach(v => TIPOS.forEach(t => { if (v.status === 'confirmado') e[t.k] -= Number(v[t.k]) || 0; else if (v.status === 'pedido') r[t.k] += Number(v[t.k]) || 0; }));
  return { e, r };
}
function renderStock() {
  const { e, r } = estoque();
  $('#stockTiles').innerHTML = TIPOS.map(t => {
    const n = e[t.k]; let pill = '';
    if (n < 0) pill = '<span class="pill bad">Conferir</span>'; else if (n === 0) pill = '<span class="pill bad">Acabou</span>'; else if (n <= POUCO) pill = '<span class="pill pend">Acabando</span>';
    return `<div class="tile"><div class="name"><span class="egg dot-${t.k}"></span>${t.n}</div><div class="big num">${S.ready ? n : '–'}</div>
      <div class="unit">${plural(n, 'cartela', 'cartelas')} ${pill}${r[t.k] ? ` · ${r[t.k]} em pedidos novos` : ''}</div></div>`;
  }).join('');
  TIPOS.forEach(t => { const el = document.getElementById('vDisp_' + t.k); if (el) el.textContent = `Em estoque: ${S.ready ? e[t.k] : '–'}`; });
}
function renderAlertas() {
  const novos = S.vendas.filter(v => v.status === 'pedido').length;
  const avis = S.vendas.filter(v => v.status === 'confirmado' && !v.pago && v.pagamento_informado_em).length;
  const b = $('#navBadge'); b.hidden = !(novos + avis); b.textContent = novos + avis;
  $('#alertas').innerHTML =
    (novos ? `<button type="button" class="row" data-ir="novos" style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--info-soft)"><span class="who"><strong>${novos} ${plural(novos, 'pedido novo', 'pedidos novos')} pelo site</strong><span>Toque para confirmar ou recusar</span></span><span class="pill info">Ver</span></button>` : '') +
    (avis ? `<button type="button" class="row" data-ir="avisados" style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--ok-soft)"><span class="who"><strong>${avis} ${plural(avis, 'cliente avisou', 'clientes avisaram')} que pagou</strong><span>Confira no banco e marque como pago</span></span><span class="pill ok">Ver</span></button>` : '');
}
$('#alertas').addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (!b) return; S.filtro = b.dataset.ir; S.busca = ''; $('#busca').value = ''; setPeriodo('lPer', S.lPer, 'tudo'); syncChips(); renderVendas(); show('vendas'); });

function renderOwed() {
  const g = new Map();
  confirmadas().filter(v => !v.pago).forEach(v => {
    const o = g.get(v.cliente_id) || { id: v.cliente_id, nome: nomeDe(v), total: 0, n: 0, desde: v.data };
    o.total += Number(v.valor) || 0; o.n++; if ((v.data || '') < (o.desde || '~')) o.desde = v.data; g.set(v.cliente_id, o);
  });
  const arr = [...g.values()].sort((a, b) => b.total - a.total);
  $('#owedTotal').textContent = brl(arr.reduce((s, o) => s + o.total, 0));
  $('#owedList').innerHTML = arr.length ? arr.map(o => `<button type="button" class="row" data-cliente="${esc(o.nome)}">
      <span class="who"><strong>${esc(o.nome)}</strong><span>${o.n} ${plural(o.n, 'venda', 'vendas')} em aberto · desde ${fmtData(o.desde)}</span></span>
      <span class="amt num">${brl(o.total)}</span></button>`).join('')
    : `<p class="empty">${S.ready ? 'Ninguém devendo. Tudo recebido.' : 'Carregando…'}</p>`;
}
$('#owedList').addEventListener('click', e => {
  const b = e.target.closest('[data-cliente]'); if (!b) return;
  S.busca = b.dataset.cliente; S.filtro = 'pendentes'; setPeriodo('lPer', S.lPer, 'tudo'); $('#busca').value = S.busca; syncChips(); renderVendas(); show('vendas');
});
function renderFeed() {
  const mov = [...S.vendas.filter(v => v.status !== 'cancelado').map(v => ({ ...v, _t: 'v' })), ...S.compras.map(c => ({ ...c, _t: 'c' }))].sort(sortDesc).slice(0, 6);
  $('#feed').innerHTML = mov.length ? mov.map(m => m._t === 'v'
    ? `<div class="row"><span class="who"><strong>${m.status === 'pedido' ? 'Pedido novo' : 'Venda'} · ${esc(nomeDe(m))}</strong><span>${fmtData(m.data)} · ${esc(itensTexto(m))}</span></span><span class="amt num">${m.status === 'pedido' ? '' : '−' + totalCartelas(m)}</span></div>`
    : `<div class="row"><span class="who"><strong>Compra · ${esc(tipoNome(m.tipo))}</strong><span>${fmtData(m.data)} · ${esc(formatoNome(m.formato))}${m.formato === 'caixa' || m.formato === 'meia' ? ' ×' + m.qtd : ''}</span></span><span class="amt num" style="color:var(--ok)">+${m.cartelas}</span></div>`
  ).join('') : `<p class="empty">${S.ready ? 'Nada registrado ainda. Comece pela aba Comprar, lançando os ovos que estão em casa.' : 'Carregando…'}</p>`;
}

/* =================== períodos e gráficos =================== */
const PERIODOS = [['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['30d', 'Últimos 30 dias'], ['3m', 'Últimos 3 meses'], ['ano', 'Este ano'], ['tudo', 'Todo o período'], ['custom', 'Escolher datas']];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dLocal = iso => new Date(String(iso).slice(0, 10) + 'T12:00:00');
function periodRange(st) {
  const t = hoje(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  switch (st.k) {
    case 'mes': return { de: `${y}-${pad(m)}-01`, ate: t };
    case 'mespassado': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { de: `${py}-${pad(pm)}-01`, ate: `${py}-${pad(pm)}-${pad(new Date(py, pm, 0).getDate())}` }; }
    case '30d': { const d = dLocal(t); d.setDate(d.getDate() - 29); return { de: ymd(d), ate: t }; }
    case '3m': { let M = m - 2, Y = y; if (M < 1) { M += 12; Y--; } return { de: `${Y}-${pad(M)}-01`, ate: t }; }
    case 'ano': return { de: `${y}-01-01`, ate: t };
    case 'custom': { let de = st.de || null, ate = st.ate || null; if (de && ate && de > ate) [de, ate] = [ate, de]; return { de, ate }; }
    default: return { de: null, ate: null };
  }
}
const inRange = (d, r) => { d = String(d || '').slice(0, 10); return (!r.de || d >= r.de) && (!r.ate || d <= r.ate); };
function montarPeriodo(id, st, onChange) {
  const el = document.getElementById(id);
  el.innerHTML = `<select id="${id}_k" aria-label="Período">${PERIODOS.map(([k, n]) => `<option value="${k}"${k === st.k ? ' selected' : ''}>${n}</option>`).join('')}</select>
    <input type="date" id="${id}_de" aria-label="De" hidden><input type="date" id="${id}_ate" aria-label="Até" hidden>`;
  el.addEventListener('change', () => {
    st.k = document.getElementById(id + '_k').value; const de = document.getElementById(id + '_de'), ate = document.getElementById(id + '_ate');
    const c = st.k === 'custom'; de.hidden = !c; ate.hidden = !c;
    if (c && !de.value) { de.value = hoje().slice(0, 8) + '01'; ate.value = hoje(); }
    st.de = de.value; st.ate = ate.value; onChange();
  });
}
function setPeriodo(id, st, k) { st.k = k; const s = document.getElementById(id + '_k'); if (s) s.value = k; ['_de', '_ate'].forEach(x => { const i = document.getElementById(id + x); if (i) i.hidden = k !== 'custom'; }); }

function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const fmtEixo = v => v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : v.toLocaleString('pt-BR');
function buckets(vs, r) {
  const ate = r.ate || hoje();
  const de = r.de || vs.reduce((m, v) => v.data && v.data < m ? v.data : m, ate);
  const d0 = dLocal(de), d1 = dLocal(ate), dias = Math.round((d1 - d0) / 864e5) + 1;
  const out = [], idx = new Map(), porDia = dias <= 45; let key;
  if (porDia) {
    for (const d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) { idx.set(ymd(d), out.length); out.push({ label: String(d.getDate()), full: `${d.getDate()} de ${MESES[d.getMonth()]}`, valor: 0, pago: 0, n: 0 }); }
    key = v => String(v.data).slice(0, 10);
  } else {
    let y = d0.getFullYear(), m = d0.getMonth(); const y1 = d1.getFullYear(), m1 = d1.getMonth();
    while (y < y1 || (y === y1 && m <= m1)) {
      idx.set(`${y}-${pad(m + 1)}`, out.length);
      out.push({ label: MESES[m] + (m === 0 || !out.length ? ' ' + String(y).slice(2) : ''), full: `${MESES[m]} de ${y}`, valor: 0, pago: 0, n: 0 });
      m++; if (m > 11) { m = 0; y++; }
    }
    key = v => String(v.data || '').slice(0, 7);
  }
  vs.forEach(v => { const i = idx.get(key(v)); if (i == null) return; const val = Number(v.valor) || 0; out[i].valor += val; if (v.pago) out[i].pago += val; out[i].n++; });
  return { out: porDia ? out : out.slice(-24), porDia };
}
function barChart(el, data, porDia) {
  const max = Math.max(0, ...data.map(b => b.valor));
  if (!max) { el.innerHTML = '<p class="empty">Nenhuma venda nesse período.</p>'; return; }
  const W = Math.max(280, Math.round(el.clientWidth || 600)), H = 210, pl = 46, pr = 6, pt = 10, pb = 24;
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const ih = H - pt - pb, iw = W - pl - pr, n = data.length, bw = iw / n, barW = Math.max(2, Math.min(34, bw * 0.7));
  const y = v => pt + ih - (v / top) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Valor vendido por ${porDia ? 'dia' : 'mês'}">`;
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmtEixo(v)}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (porDia ? 30 : 44)))));
  data.forEach((b, i) => {
    const cx = pl + bw * i + bw / 2, x = cx - barW / 2, h = (b.valor / top) * ih, yy = pt + ih - h, r = Math.min(4, barW / 2, h);
    const path = h > 0 ? `M${x},${pt + ih}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + barW - r}Q${x + barW},${yy} ${x + barW},${yy + r}V${pt + ih}Z` : '';
    const aberto = b.valor - b.pago;
    const tip = `${b.full}|${brl(b.valor)} vendido|${b.n} ${plural(b.n, 'venda', 'vendas')}${aberto > 0.004 ? ' · ' + brl(aberto) + ' em aberto' : ''}`;
    s += `<g class="col" data-tip="${esc(tip)}">${path ? `<path class="barra" d="${path}"/>` : ''}<rect class="hit" x="${pl + bw * i}" y="${pt}" width="${bw}" height="${ih}"/></g>`;
    if (i % every === 0) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  el.innerHTML = s + `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}"/></svg>`;
}
function hbars(rows, fmt) {
  const max = Math.max(0, ...rows.map(r => r.v));
  if (!max) return '<p class="empty">Nenhuma venda nesse período.</p>';
  return rows.map(r => `<div class="hb"><span class="l">${r.dot || ''}<span title="${esc(r.nome)}">${esc(r.nome)}</span></span>
    <div><div class="fill" style="width:${(r.v / max * 100).toFixed(1)}%"></div></div><span class="v">${fmt(r.v)}</span></div>`).join('');
}
function renderDash() {
  if (!S.ready) { $('#chMeses').innerHTML = '<p class="empty">Carregando…</p>'; return; }
  const r = periodRange(S.dPer);
  const vs = confirmadas().filter(v => inRange(v.data, r)), cs = S.compras.filter(c => inRange(c.data, r));
  const vendido = vs.reduce((s, v) => s + (Number(v.valor) || 0), 0), recebido = vs.filter(v => v.pago).reduce((s, v) => s + (Number(v.valor) || 0), 0);
  const cart = vs.reduce((s, v) => s + totalCartelas(v), 0);
  $('#kpis').innerHTML = `<div class="kpi"><span>Vendido</span><b class="num">${brl(vendido)}</b></div>
    <div class="kpi"><span>Recebido</span><b class="num">${brl(recebido)}</b></div>
    <div class="kpi pend"><span>Em aberto</span><b class="num">${brl(vendido - recebido)}</b></div>
    <div class="kpi"><span>Cartelas vendidas</span><b class="num">${cart}</b></div>`;
  const cc = cs.reduce((s, c) => s + (Number(c.cartelas) || 0), 0), gasto = cs.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  $('#kpiCompras').textContent = cs.length ? `Compras no período: ${cc} ${plural(cc, 'cartela', 'cartelas')}${gasto ? `, ${brl(gasto)} pagos à distribuidora` : ''}.` : 'Nenhuma compra registrada nesse período.';
  const b = buckets(vs, r);
  $('#chMesesSub').textContent = b.porDia ? 'por dia, em R$' : 'por mês, em R$';
  barChart($('#chMeses'), b.out, b.porDia);
  $('#chTipos').innerHTML = hbars(TIPOS.map(t => ({ nome: t.n, dot: `<i class="egg dot-${t.k}" style="width:10px;height:13px"></i>`, v: vs.reduce((s, v) => s + (Number(v[t.k]) || 0), 0) })), v => v);
  const g = new Map(); vs.forEach(v => { const o = g.get(v.cliente_id) || { nome: nomeDe(v), v: 0 }; o.v += Number(v.valor) || 0; g.set(v.cliente_id, o); });
  $('#chClientes').innerHTML = hbars([...g.values()].sort((a, b) => b.v - a.v).slice(0, 5), brl);
}
const tipEl = () => $('#tip');
function showTip(g, x, y) {
  const t = tipEl(); const [a, b, c] = g.dataset.tip.split('|');
  t.innerHTML = `<b>${esc(a)}</b><br>${esc(b)}<br>${esc(c)}`; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight; let L = x + 12, T = y - h - 10; if (L + w > innerWidth - 8) L = x - w - 12; if (L < 8) L = 8; if (T < 8) T = y + 16;
  t.style.left = L + 'px'; t.style.top = T + 'px';
}
document.addEventListener('pointermove', e => { const g = e.target.closest?.('.col[data-tip]'); if (g) showTip(g, e.clientX, e.clientY); else if (e.pointerType === 'mouse') tipEl().hidden = true; });
document.addEventListener('pointerdown', e => { const g = e.target.closest?.('.col[data-tip]'); if (g) showTip(g, e.clientX, e.clientY); else tipEl().hidden = true; });
document.addEventListener('scroll', () => { tipEl().hidden = true; }, { passive: true });
let rzT = null; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (!$('#v-painel').hidden) renderDash(); }, 150); });

/* =================== WhatsApp =================== */
const tplDe = tipo => (S.config['msg_' + tipo] && S.config['msg_' + tipo].trim()) ? S.config['msg_' + tipo] : MSG_PADRAO[tipo];
function montarMsg(tpl, v) {
  const aberto = confirmadas().filter(x => !x.pago && x.cliente_id === v.cliente_id).reduce((s, x) => s + (Number(x.valor) || 0), 0);
  const vals = { pedido: `${itensTexto(v)} (${brl(v.valor)})`, cliente: String(v.nome || nomeDe(v)).trim(), valor: brl(v.valor), data: fmtData(v.data), total_aberto: brl(aberto), link: LINK_SITE };
  return tpl.replace(/\{(\w+)\}/g, (m, x) => vals[x] != null ? vals[x] : m).replace(/ /g, ' ');
}
const waLink = (v, tipo) => `https://wa.me/${telWa(cliPorId(v.cliente_id).telefone)}?text=${encodeURIComponent(montarMsg(tplDe(tipo), v))}`;

/* =================== vender =================== */
$('#vQty').innerHTML = TIPOS.map(t => `<div class="qrow"><div class="tn"><span class="egg dot-${t.k}" style="width:16px;height:20px"></span><div><strong>${t.n}</strong><span id="vDisp_${t.k}">Em estoque: –</span></div></div>
  <div class="step"><button type="button" data-step="-1" data-t="${t.k}" aria-label="Menos ${t.n}">−</button>
  <input type="number" id="vQ_${t.k}" min="0" step="1" value="0" inputmode="numeric" aria-label="Cartelas de ${t.n}">
  <button type="button" data-step="1" data-t="${t.k}" aria-label="Mais ${t.n}">+</button></div></div>`).join('');
const qtdVenda = () => Object.fromEntries(TIPOS.map(t => [t.k, Math.max(0, Math.floor(Number($('#vQ_' + t.k).value) || 0))]));
function valorCalculado(q) {
  let total = 0, falta = false, tem = false;
  TIPOS.forEach(t => { if (!q[t.k]) return; tem = true; const p = S.config['preco_' + t.k]; if (p == null) falta = true; else total += q[t.k] * Number(p); });
  return (!tem || falta) ? null : Math.round(total * 100) / 100;
}
function renderVendaHints() {
  const q = qtdVenda(), calc = valorCalculado(q);
  if (!S.valorManual) $('#vValor').value = calc != null ? moneyField(calc) : '';
  const tem = totalCartelas(q) > 0;
  $('#vValorHint').innerHTML = !tem ? 'Escolha as cartelas acima.' : calc == null ? 'Preencha o preço da cartela em Ajustes para calcular sozinho.'
    : S.valorManual ? `Pelos preços seria ${brl(calc)}. <button type="button" class="linkbtn" id="vUsarCalc">Usar esse</button>` : 'Calculado pelos preços em Ajustes.';
  const { e } = estoque(), passou = TIPOS.filter(t => q[t.k] > e[t.k]), av = $('#vAviso');
  if (S.ready && passou.length) { av.hidden = false; av.textContent = passou.map(t => `Só tem ${e[t.k]} ${plural(e[t.k], 'cartela', 'cartelas')} de ${t.n} no estoque.`).join(' ') + ' Dá para salvar mesmo assim, mas vale conferir.'; }
  else av.hidden = true;
}
$('#vQty').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (!b) return; const i = $('#vQ_' + b.dataset.t); i.value = Math.max(0, (Math.floor(Number(i.value) || 0)) + Number(b.dataset.step)); renderVendaHints(); });
$('#vQty').addEventListener('input', renderVendaHints);
$('#vValor').addEventListener('input', () => { S.valorManual = $('#vValor').value.trim() !== ''; renderVendaHints(); });
$('#vValorHint').addEventListener('click', e => { if (e.target.id === 'vUsarCalc') { S.valorManual = false; renderVendaHints(); } });
document.querySelectorAll('input[name=vPago]').forEach(r => r.addEventListener('change', () => { $('#vPagoBox').hidden = !$('#vPagoSim').checked; }));
$('#vCliente').addEventListener('input', () => {
  $('#vOk').hidden = true;
  const k = keyNome($('#vCliente').value), c = S.clientes.find(x => keyNome(x.nome) === k), t = $('#vTel');
  if (c?.telefone && (!t.value || t.dataset.auto === '1')) { t.value = fmtTel(c.telefone); t.dataset.auto = '1'; }
  else if (!c?.telefone && t.dataset.auto === '1') { t.value = ''; t.dataset.auto = '0'; }
});
$('#vTel').addEventListener('input', e => { e.target.dataset.auto = '0'; });
$('#vOkFechar').addEventListener('click', () => { $('#vOk').hidden = true; });
function resetVenda() { $('#vTel').dataset.auto = '0'; $('#fVenda').reset(); TIPOS.forEach(t => $('#vQ_' + t.k).value = 0); $('#vData').value = hoje(); $('#vPagoBox').hidden = true; S.valorManual = false; renderVendaHints(); }
$('#fVenda').addEventListener('submit', async e => {
  e.preventDefault(); if (S.busy) return;
  const nome = $('#vCliente').value.trim().replace(/\s+/g, ' ');
  if (!nome) { toast('Escreva o nome de quem comprou.'); $('#vCliente').focus(); return; }
  const q = qtdVenda(); if (!totalCartelas(q)) { toast('Coloque pelo menos 1 cartela.'); return; }
  const valor = parseMoney($('#vValor').value) ?? valorCalculado(q) ?? 0;
  const pago = $('#vPagoSim').checked, data = $('#vData').value || hoje();
  const btn = $('#vSalvar'); S.busy = true; btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const cliente_id = await clienteIdPorNome(nome, $('#vTel').value);
    let comprovante_path = null; const f = $('#vComp').files[0];
    if (pago && f) { btn.textContent = 'Enviando comprovante…'; comprovante_path = await enviarComprovante(f, 'admin'); }
    const venda = { cliente_id, data, ...q, valor, status: 'confirmado', origem: 'admin', pago, forma: pago ? $('#vForma').value : null, pago_em: pago ? data : null, comprovante_path, obs: $('#vObs').value.trim() || null };
    const { error } = await sb.from('vendas').insert(venda); if (error) throw error;
    resetVenda(); await carregar();
    $('#vOkTxt').textContent = `Venda para ${nome} registrada${pago ? ' como paga' : ''}.`;
    const tel = cliPorId(cliente_id).telefone;
    $('#vOkSub').textContent = tel ? ` Avise no WhatsApp ${fmtTel(tel)}; a mensagem já vai escrita.` : ' Sem telefone salvo: o WhatsApp vai pedir para escolher o contato.';
    $('#vOkWa').href = waLink({ ...venda, nome }, 'pedido'); $('#vOk').hidden = false;
  } catch (err) { toast(erroTexto(err)); }
  finally { S.busy = false; btn.disabled = false; btn.textContent = 'Registrar venda'; }
});

/* =================== comprar =================== */
$('#cTipos').innerHTML = TIPOS.map((t, i) => `<label class="choice"><input type="radio" name="cTipo" value="${t.k}" ${i === 0 ? 'checked' : ''}><span><i class="egg dot-${t.k}"></i>${t.n}</span></label>`).join('');
$('#cFormatos').innerHTML = FORMATOS.map((f, i) => `<label class="choice"><input type="radio" name="cFormato" value="${f.k}" ${i === 0 ? 'checked' : ''}><span>${f.n}<small>${f.sub}</small></span></label>`).join('');
function renderCompraResumo() {
  const f = FORMATOS.find(x => x.k === document.querySelector('input[name=cFormato]:checked').value), t = document.querySelector('input[name=cTipo]:checked').value;
  $('#cQtdLbl').textContent = f.lbl;
  const total = Math.max(0, Math.floor(Number($('#cQtd').value) || 0)) * f.mult;
  $('#cResumo').innerHTML = total > 0 ? `Entram <b class="num">${total}</b> ${plural(total, 'cartela', 'cartelas')} de ${tipoNome(t)} no estoque.` : 'Digite a quantidade.';
}
$('#fCompra').addEventListener('input', renderCompraResumo);
$('#fCompra').addEventListener('change', renderCompraResumo);
$('#fCompra').addEventListener('submit', async e => {
  e.preventDefault(); if (S.busy) return;
  const f = FORMATOS.find(x => x.k === document.querySelector('input[name=cFormato]:checked').value), tipo = document.querySelector('input[name=cTipo]:checked').value;
  const qtd = Math.max(0, Math.floor(Number($('#cQtd').value) || 0)), cartelas = qtd * f.mult;
  if (!cartelas) { toast('Digite a quantidade.'); return; }
  const btn = $('#cSalvar'); S.busy = true; btn.disabled = true;
  try {
    await salvar(sb.from('compras').insert({ tipo, formato: f.k, qtd, cartelas, valor: parseMoney($('#cValor').value), data: $('#cData').value || hoje() }),
      `${cartelas} ${plural(cartelas, 'cartela', 'cartelas')} de ${tipoNome(tipo)} entraram no estoque.`);
    $('#cQtd').value = 1; $('#cValor').value = ''; renderCompraResumo();
  } catch (err) { toast(erroTexto(err)); }
  finally { S.busy = false; btn.disabled = false; }
});
function renderCompras() {
  const arr = S.compras.slice().sort(sortDesc).slice(0, 40);
  $('#listaCompras').innerHTML = arr.length ? arr.map(c => {
    const id = esc(c.id), qtdTxt = (c.formato === 'caixa' || c.formato === 'meia') ? `${c.qtd} × ${formatoNome(c.formato)}` : formatoNome(c.formato);
    const conf = S.delCompra === c.id ? `<div class="confirm"><span>Excluir esta compra? ${c.cartelas} ${plural(c.cartelas, 'cartela sai', 'cartelas saem')} do estoque.</span>
      <div class="actions"><button type="button" class="btn small danger" data-act="cSim" data-id="${id}">Sim, excluir</button><button type="button" class="btn small ghost" data-act="cNao">Cancelar</button></div></div>` : '';
    return `<article class="card"><div class="ctop"><strong><span class="egg dot-${esc(c.tipo)}" style="width:12px;height:15px;margin-right:6px;vertical-align:-1px"></span>${esc(tipoNome(c.tipo))}</strong><span class="pill ok num">+${c.cartelas} ${plural(c.cartelas, 'cartela', 'cartelas')}</span></div>
      <div class="meta num"><span>${fmtData(c.data)}</span><span>${esc(qtdTxt)}</span>${c.valor != null ? `<span class="val">${brl(c.valor)}</span>` : ''}
      ${S.delCompra !== c.id ? `<button type="button" class="linkbtn" data-act="cExcluir" data-id="${id}" style="margin-left:auto">Excluir</button>` : ''}</div>${conf}</article>`;
  }).join('') : `<p class="empty">${S.ready ? 'Nenhuma compra registrada ainda.' : 'Carregando…'}</p>`;
}
$('#listaCompras').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'cExcluir') { S.delCompra = b.dataset.id; renderCompras(); }
  else if (b.dataset.act === 'cNao') { S.delCompra = null; renderCompras(); }
  else if (b.dataset.act === 'cSim') { try { S.delCompra = null; await salvar(sb.from('compras').delete().eq('id', b.dataset.id), 'Compra excluída.'); } catch (err) { toast(erroTexto(err)); } }
});

/* =================== vendas =================== */
function syncChips() { document.querySelectorAll('#filtros [data-filtro]').forEach(c => c.setAttribute('aria-pressed', c.dataset.filtro === S.filtro ? 'true' : 'false')); }
$('#filtros').addEventListener('click', e => { const c = e.target.closest('[data-filtro]'); if (!c) return; S.filtro = c.dataset.filtro; syncChips(); renderVendas(); });
$('#busca').addEventListener('input', e => { S.busca = e.target.value; renderVendas(); });

function statusPill(v) {
  if (v.status === 'pedido') return '<span class="pill info">Pedido novo</span>';
  if (v.status === 'cancelado') return '<span class="pill mute">Cancelado</span>';
  if (v.pago) return `<span class="pill ok">Pago${v.forma ? ' · ' + esc(v.forma) : ''}</span>`;
  if (v.pagamento_informado_em) return '<span class="pill info">Cliente avisou que pagou</span>';
  return '<span class="pill pend">A receber</span>';
}
function renderVendas() {
  const panel = $('#payPanel'); document.body.appendChild(panel);
  const novos = S.vendas.filter(v => v.status === 'pedido').length, avis = S.vendas.filter(v => v.status === 'confirmado' && !v.pago && v.pagamento_informado_em).length;
  document.querySelector('[data-filtro=novos]').textContent = `Pedidos novos${novos ? ` (${novos})` : ''}`;
  document.querySelector('[data-filtro=avisados]').textContent = `Pagamento avisado${avis ? ` (${avis})` : ''}`;
  const q = keyNome(S.busca), per = periodRange(S.lPer);
  let arr = S.vendas.slice().sort(sortDesc);
  const F = { novos: v => v.status === 'pedido', avisados: v => v.status === 'confirmado' && !v.pago && v.pagamento_informado_em, pendentes: v => v.status === 'confirmado' && !v.pago,
    pagas: v => v.status === 'confirmado' && v.pago, canceladas: v => v.status === 'cancelado', todas: () => true };
  arr = arr.filter(F[S.filtro] || F.todas).filter(v => inRange(v.data, per));
  if (q) arr = arr.filter(v => keyNome(nomeDe(v)).includes(q));
  const conf = arr.filter(v => v.status === 'confirmado'), tot = conf.reduce((s, v) => s + (Number(v.valor) || 0), 0), pend = conf.filter(v => !v.pago).reduce((s, v) => s + (Number(v.valor) || 0), 0);
  $('#lResumo').textContent = S.ready ? `${arr.length} ${plural(arr.length, 'registro', 'registros')}${conf.length ? ` · ${brl(tot)} vendidos` : ''}${pend > 0.004 ? ` · ${brl(pend)} em aberto` : ''}` : '';
  $('#listaVendas').innerHTML = arr.length ? arr.map(cardVenda).join('') : `<p class="empty">${!S.ready ? 'Carregando…' : S.filtro === 'novos' ? 'Nenhum pedido novo.' : S.filtro === 'pendentes' && !q ? 'Nenhuma venda em aberto.' : 'Nada encontrado.'}</p>`;
  if (S.payOpen) {
    const card = document.querySelector(`[data-card="${CSS.escape(S.payOpen)}"]`);
    if (card) { card.appendChild(panel); panel.hidden = false; } else { S.payOpen = null; panel.hidden = true; }
  } else panel.hidden = true;
}
function cardVenda(v) {
  const id = esc(v.id), nome = nomeDe(v); let acts = '', extra = '';
  if (v.status === 'pedido') {
    if (S.recusarOpen === v.id) extra = `<div class="confirm"><span>Recusar o pedido de <b>${esc(nome)}</b>? Ela vê o pedido como cancelado.</span><div class="actions"><button type="button" class="btn small danger" data-act="recusarSim" data-id="${id}">Sim, recusar</button><button type="button" class="btn small ghost" data-act="fechar">Voltar</button></div></div>`;
    else acts += `<button type="button" class="btn small" data-act="confirmar" data-id="${id}">Confirmar pedido</button><button type="button" class="btn small ghost" data-act="recusar" data-id="${id}">Recusar</button>`;
  }
  if (v.status === 'confirmado') {
    if (S.recemConfirmado === v.id) acts += `<a class="btn small wa" href="${esc(waLink(v, 'pedido'))}" target="_blank" rel="noopener">Avisar no WhatsApp</a>`;
    if (v.pago) acts += `<button type="button" class="btn small ghost" data-act="desfazer" data-id="${id}">Desfazer pagamento</button>`;
    else {
      if (S.payOpen !== v.id) acts += `<button type="button" class="btn small" data-act="pagar" data-id="${id}">${v.pagamento_informado_em ? 'Conferi, marcar como pago' : 'Marcar como pago'}</button>`;
      if (S.recemConfirmado !== v.id) acts += `<a class="btn small wa" href="${esc(waLink(v, 'lembrete'))}" target="_blank" rel="noopener">Lembrar no WhatsApp</a>`;
    }
  }
  if (v.comprovante_path) acts += `<button type="button" class="btn small ghost" data-act="comp" data-id="${id}">Ver comprovante</button>`;
  if (S.delOpen === v.id) extra += `<div class="confirm"><span>Excluir de vez o registro de <b>${esc(nome)}</b>? ${v.status === 'confirmado' ? 'As cartelas voltam para o estoque.' : ''}</span><div class="actions"><button type="button" class="btn small danger" data-act="excluirSim" data-id="${id}">Sim, excluir</button><button type="button" class="btn small ghost" data-act="fechar">Cancelar</button></div></div>`;
  else if (v.status !== 'pedido') acts += `<button type="button" class="linkbtn" data-act="excluir" data-id="${id}" style="margin-left:auto">Excluir</button>`;
  const cls = v.status === 'pedido' ? 'novo' : (v.status === 'confirmado' && !v.pago ? 'pendente' : '');
  return `<article class="card ${cls}" data-card="${id}">
    <div class="ctop"><strong>${esc(nome)}</strong>${statusPill(v)}</div>
    <div class="items">${itensHTML(v)}</div>
    <div class="meta num"><span>${v.status === 'pedido' ? 'Pedido em' : 'Vendido em'} ${fmtData(v.data)}</span>${v.origem === 'cliente' ? '<span>pelo site</span>' : ''}${v.pago && v.pago_em ? `<span>Pago em ${fmtData(v.pago_em)}</span>` : ''}${!v.pago && v.pagamento_informado_em ? `<span>Avisou em ${fmtData(v.pagamento_informado_em)}</span>` : ''}<span class="val">${brl(v.valor)}</span></div>
    ${v.obs ? `<div class="obs">${esc(v.obs)}</div>` : ''}
    <div class="actions">${acts}</div>${extra}
  </article>`;
}
$('#listaVendas').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const v = S.vendas.find(x => x.id === b.dataset.id), act = b.dataset.act;
  const fechar = () => { S.delOpen = S.recusarOpen = null; };
  if (act === 'fechar') { fechar(); renderVendas(); return; }
  if (act === 'comp') { abrirComprovante(v.comprovante_path); return; }
  if (act === 'pagar') { fechar(); S.payOpen = v.id; $('#pComp').value = ''; $('#pForma').value = v.forma || 'Pix'; renderVendas(); return; }
  if (act === 'excluir') { fechar(); S.delOpen = v.id; S.payOpen = null; renderVendas(); return; }
  if (act === 'recusar') { fechar(); S.recusarOpen = v.id; renderVendas(); return; }
  try {
    if (act === 'confirmar') {
      const { e: est } = estoque(), falta = TIPOS.filter(t => v[t.k] > est[t.k]);
      await salvar(sb.from('vendas').update({ status: 'confirmado' }).eq('id', v.id).eq('status', 'pedido'),
        falta.length ? `Pedido confirmado. Atenção: o estoque de ${falta.map(t => t.n).join(' e ')} ficou negativo.` : `Pedido de ${nomeDe(v)} confirmado.`);
      S.recemConfirmado = v.id; renderVendas();
    }
    if (act === 'recusarSim') { fechar(); await salvar(sb.from('vendas').update({ status: 'cancelado' }).eq('id', v.id), 'Pedido recusado.'); }
    if (act === 'desfazer') await salvar(sb.from('vendas').update({ pago: false, pago_em: null, forma: null, pagamento_informado_em: null }).eq('id', v.id), `Venda de ${nomeDe(v)} voltou para "a receber".`);
    if (act === 'excluirSim') {
      fechar();
      await salvar(sb.from('vendas').delete().eq('id', v.id), 'Registro excluído.');
      if (v.comprovante_path && !S.vendas.some(x => x.comprovante_path === v.comprovante_path)) await sb.storage.from('comprovantes').remove([v.comprovante_path]);
    }
  } catch (err) { toast(erroTexto(err)); }
});
$('#pCancelar').addEventListener('click', () => { S.payOpen = null; renderVendas(); });
$('#pConfirmar').addEventListener('click', async () => {
  if (S.busy) return; const v = S.vendas.find(x => x.id === S.payOpen); if (!v) return;
  const btn = $('#pConfirmar'); S.busy = true; btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    let comprovante_path = v.comprovante_path || null; const f = $('#pComp').files[0];
    if (f) { btn.textContent = 'Enviando comprovante…'; comprovante_path = await enviarComprovante(f, 'admin'); }
    S.payOpen = null;
    await salvar(sb.from('vendas').update({ pago: true, forma: $('#pForma').value, pago_em: hoje(), comprovante_path }).eq('id', v.id), `${nomeDe(v)} pagou ${brl(v.valor)}. Anotado.`);
  } catch (err) { toast(erroTexto(err)); }
  finally { S.busy = false; btn.disabled = false; btn.textContent = 'Confirmar pagamento'; }
});

/* =================== ajustes =================== */
TIPOS.forEach(t => $('#pr_' + t.k).addEventListener('change', async e => {
  const v = parseMoney(e.target.value);
  try { await salvar(sb.from('config').update({ ['preco_' + t.k]: v, updated_at: new Date().toISOString() }).eq('id', 1), v == null ? `Preço de ${t.n} removido. Ele some do site da cliente.` : `Preço da cartela de ${t.n} salvo.`); }
  catch (err) { toast(erroTexto(err)); }
}));
$('#cfgLink').value = LINK_SITE;
$('#copiarLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(LINK_SITE); toast('Link copiado.'); } catch (_) { $('#cfgLink').select(); } });
$('#cfgAceitando').addEventListener('change', async e => {
  const on = e.target.checked;
  try { await salvar(sb.from('config').update({ aceitando_pedidos: on }).eq('id', 1), on ? 'Pedidos pelo site ativados.' : 'Pedidos pelo site pausados.'); }
  catch (err) { e.target.checked = !on; toast(erroTexto(err)); }
});
$('#salvarSite').addEventListener('click', async () => {
  try { await salvar(sb.from('config').update({ aviso_clientes: $('#cfgAviso').value.trim() || null }).eq('id', 1), 'Recado salvo.'); }
  catch (err) { toast(erroTexto(err)); }
});
$('#salvarPix').addEventListener('click', async () => {
  const tipo = $('#pixTipo').value, chave = normalizarChavePix(tipo, $('#pixChave').value);
  if (chave && !tipo) { toast('Escolha o tipo da chave Pix.'); return; }
  if (tipo === 'cpf' && chave.length !== 11) { toast('O CPF precisa ter 11 números.'); return; }
  if (tipo === 'celular' && !/^\+55\d{10,11}$/.test(chave)) { toast('Confira o celular com DDD.'); return; }
  try {
    await salvar(sb.from('config').update({ pix_tipo: tipo || null, pix_chave: chave || null, pix_nome: $('#pixNome').value.trim() || null, pix_cidade: $('#pixCidade').value.trim() || null }).eq('id', 1), 'Pix salvo.');
  } catch (err) { toast(erroTexto(err)); }
});
function renderAjustes() {
  const c = S.config, ativo = document.activeElement;
  TIPOS.forEach(t => { const i = $('#pr_' + t.k); if (ativo !== i) i.value = moneyField(c['preco_' + t.k]); });
  if (ativo !== $('#cfgAviso')) $('#cfgAviso').value = c.aviso_clientes || '';
  $('#cfgAceitando').checked = !!c.aceitando_pedidos;
  if (![$('#pixTipo'), $('#pixChave'), $('#pixNome'), $('#pixCidade')].includes(ativo)) {
    $('#pixTipo').value = c.pix_tipo || ''; $('#pixChave').value = c.pix_tipo === 'celular' ? fmtTel(c.pix_chave) : (c.pix_chave || '');
    $('#pixNome').value = c.pix_nome || ''; $('#pixCidade').value = c.pix_cidade || '';
  }
  renderMsgs(); renderClientes();
  $('#espaco').textContent = `Registros guardados: ${(S.vendas.length + S.compras.length + S.clientes.length).toLocaleString('pt-BR')}.`;
}
// mensagens
let campoMsg = 'mPedido';
['mPedido', 'mLembrete'].forEach(id => { $('#' + id).addEventListener('focus', () => campoMsg = id); $('#' + id).addEventListener('input', () => { S.msgDirty = true; renderMsgs(); }); });
$('#mVars').addEventListener('click', e => {
  const b = e.target.closest('[data-var]'); if (!b) return; const ta = $('#' + campoMsg);
  const a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, a) + b.dataset.var + ta.value.slice(z); ta.focus(); ta.selectionStart = ta.selectionEnd = a + b.dataset.var.length;
  S.msgDirty = true; renderMsgs();
});
$('#mPadrao').addEventListener('click', () => { $('#mPedido').value = MSG_PADRAO.pedido; $('#mLembrete').value = MSG_PADRAO.lembrete; S.msgDirty = true; renderMsgs(); toast('Mensagens padrão de volta. Toque em Salvar para manter.'); });
$('#mSalvar').addEventListener('click', async () => {
  try { await salvar(sb.from('config').update({ msg_pedido: $('#mPedido').value.trim() || null, msg_lembrete: $('#mLembrete').value.trim() || null }).eq('id', 1), 'Mensagens salvas.'); S.msgDirty = false; }
  catch (err) { toast(erroTexto(err)); }
});
function renderMsgs() {
  if (!S.msgDirty) ['pedido', 'lembrete'].forEach(t => { const el = $('#m' + t[0].toUpperCase() + t.slice(1)); if (document.activeElement !== el) el.value = tplDe(t); });
  const r = confirmadas().slice().sort(sortDesc)[0];
  const v = r || { cliente_id: null, nome: 'Maria', extra: 2, jumbo: 1, vermelho: 0, valor: 45, data: hoje() };
  $('#mPedidoPrev').textContent = montarMsg($('#mPedido').value || MSG_PADRAO.pedido, v);
  $('#mLembretePrev').textContent = montarMsg($('#mLembrete').value || MSG_PADRAO.lembrete, v);
  $('#mExemplo').textContent = r ? `A prévia usa a venda mais recente (${nomeDe(r)}).` : 'A prévia usa uma venda de exemplo (Maria, 2 Extra e 1 Jumbo).';
}
// clientes
function renderClientes() {
  const box = $('#listaClientes'); if (box.contains(document.activeElement)) return;
  const lista = S.clientes.filter(c => c.user_id !== S.uid).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  box.innerHTML = lista.length ? lista.map(c => `<article class="card" data-cid="${esc(c.id)}">
    <div class="ctop"><strong>${esc(c.nome)}</strong>${c.user_id ? '<span class="pill ok">Tem conta no site</span>' : '<span class="pill mute">Sem conta</span>'}</div>
    <div class="two">
      <div class="field"><label for="cn_${esc(c.id)}">Nome</label><input type="text" id="cn_${esc(c.id)}" data-campo="nome" value="${esc(c.nome)}"></div>
      <div class="field"><label for="ct_${esc(c.id)}">WhatsApp</label><input type="tel" inputmode="tel" id="ct_${esc(c.id)}" data-campo="telefone" value="${esc(fmtTel(c.telefone))}" placeholder="(11) 99999-9999"></div>
    </div>
    ${c.user_id ? '' : `<div class="field"><label for="ce_${esc(c.id)}">E-mail (para ligar à conta quando ela se cadastrar)</label><input type="email" id="ce_${esc(c.id)}" data-campo="email" value="${esc(c.email || '')}"></div>`}
  </article>`).join('') : `<p class="empty">${S.ready ? 'As clientes aparecem aqui depois da primeira venda ou cadastro no site.' : 'Carregando…'}</p>`;
}
$('#listaClientes').addEventListener('change', async e => {
  const i = e.target.closest('input[data-campo]'), card = e.target.closest('[data-cid]'); if (!i || !card) return;
  let val = i.value.trim(); if (i.dataset.campo === 'telefone') val = soDigitos(val); if (i.dataset.campo === 'email') val = val.toLowerCase();
  if (i.dataset.campo === 'nome' && !val) { toast('O nome não pode ficar vazio.'); return; }
  try { const { error } = await sb.from('clientes').update({ [i.dataset.campo]: val || null }).eq('id', card.dataset.cid); if (error) throw error; toast('Cliente atualizada.'); i.blur(); await carregar(); }
  catch (err) { toast(erroTexto(err)); }
});

/* =================== CSV: exportar e importar =================== */
const csvCell = v => { v = v == null ? '' : String(v); return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const dataBR = iso => iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '';
const numBR = n => n == null || n === '' ? '' : Number(n).toFixed(2).replace('.', ',');
const csv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
function baixar(nome, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000); toast('Arquivo exportado.');
}
function exportarVendas() {
  if (!S.vendas.length) { toast('Ainda não há vendas para exportar.'); return; }
  const st = v => v.status === 'pedido' ? 'Pedido novo' : v.status === 'cancelado' ? 'Cancelado' : v.pago ? 'Pago' : 'A receber';
  const rows = S.vendas.slice().sort((a, b) => -sortDesc(a, b)).map(v => [dataBR(v.data), nomeDe(v), v.extra, v.jumbo, v.vermelho, totalCartelas(v), numBR(v.valor), st(v), v.forma || '', dataBR(v.pago_em), v.comprovante_path ? 'Sim' : 'Não', v.obs || '', v.origem === 'cliente' ? 'Site' : 'Vendedora']);
  baixar(`vendas-franciegg-${hoje()}.csv`, csv(['Data da venda', 'Cliente', 'Extra (cartelas)', 'Jumbo (cartelas)', 'Vermelho (cartelas)', 'Total de cartelas', 'Valor (R$)', 'Situação', 'Forma de pagamento', 'Data do pagamento', 'Tem comprovante', 'Observação', 'Origem'], rows));
}
function exportarCompras() {
  if (!S.compras.length) { toast('Ainda não há compras para exportar.'); return; }
  const rows = S.compras.slice().sort((a, b) => -sortDesc(a, b)).map(c => [dataBR(c.data), tipoNome(c.tipo), formatoNome(c.formato), c.qtd, c.cartelas, numBR(c.valor)]);
  baixar(`compras-franciegg-${hoje()}.csv`, csv(['Data da compra', 'Tipo', 'Formato', 'Quantidade', 'Cartelas', 'Valor pago (R$)'], rows));
}
['#btnCsv', '#btnCsv2'].forEach(s => $(s).addEventListener('click', exportarVendas));
['#btnCsvCompras', '#btnCsvCompras2'].forEach(s => $(s).addEventListener('click', exportarCompras));

export function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) { if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some(x => x !== '')) linhas.push(linha); linha = []; }
    else campo += ch;
  }
  linha.push(campo); if (linha.some(x => x !== '')) linhas.push(linha);
  return linhas;
}
const isoDeBR = s => { const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const numDeBR = s => { const t = String(s || '').trim(); if (!t) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : null; };
const tipoDeNome = s => (TIPOS.find(t => keyNome(t.n) === keyNome(s)) || {}).k;
const formatoDeNome = s => (FORMATOS.find(f => keyNome(f.n) === keyNome(s)) || {}).k;
export function interpretarImport(linhas) {
  const h = linhas[0] || [];
  if (h[0] === 'Data da venda') {
    const itens = linhas.slice(1).map(r => {
      const sit = keyNome(r[7]);
      return { data: isoDeBR(r[0]), nome: String(r[1] || '').trim(), extra: +r[2] || 0, jumbo: +r[3] || 0, vermelho: +r[4] || 0, valor: numDeBR(r[6]) || 0,
        status: sit === 'cancelado' ? 'cancelado' : sit === 'pedido novo' ? 'pedido' : 'confirmado', pago: sit === 'pago', forma: r[8] || null, pago_em: isoDeBR(r[9]),
        obs: [r[11], keyNome(r[10]) === 'sim' ? '(comprovante no sistema antigo)' : ''].filter(Boolean).join(' ') || null };
    }).filter(x => x.data && x.nome && x.extra + x.jumbo + x.vermelho > 0);
    return { tipo: 'vendas', itens };
  }
  if (h[0] === 'Data da compra') {
    const itens = linhas.slice(1).map(r => ({ data: isoDeBR(r[0]), tipo: tipoDeNome(r[1]), formato: formatoDeNome(r[2]) || 'personalizado', qtd: +r[3] || 0, cartelas: +r[4] || 0, valor: numDeBR(r[5]) }))
      .filter(x => x.data && x.tipo && x.qtd > 0 && x.cartelas > 0);
    return { tipo: 'compras', itens };
  }
  return { tipo: null, itens: [] };
}
let importando = null;
$('#impArq').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  importando = interpretarImport(lerCsv(await f.text()));
  const box = $('#impPrev');
  if (!importando.tipo) { box.innerHTML = '<p class="warnbox" style="margin:0">Não reconheci esse arquivo. Use os CSVs exportados pelo FranciEgg.</p>'; return; }
  const n = importando.itens.length, nomes = new Set(importando.itens.map(x => keyNome(x.nome))).size;
  box.innerHTML = `<div class="summary">Encontrei ${n} ${importando.tipo === 'vendas' ? `${plural(n, 'venda', 'vendas')} de ${nomes} ${plural(nomes, 'cliente', 'clientes')}` : plural(n, 'compra', 'compras')}.</div>
    <p class="hint">Importe cada arquivo uma vez só; importar de novo duplica os registros.</p>
    <div class="actions"><button type="button" class="btn" id="impOk">Importar ${n} ${plural(n, 'registro', 'registros')}</button><button type="button" class="btn ghost" id="impNao">Cancelar</button></div>`;
});
$('#impPrev').addEventListener('click', async e => {
  if (e.target.id === 'impNao') { importando = null; $('#impPrev').innerHTML = ''; $('#impArq').value = ''; return; }
  if (e.target.id !== 'impOk' || !importando) return;
  const btn = e.target; btn.disabled = true; btn.textContent = 'Importando…';
  try {
    if (importando.tipo === 'compras') {
      for (let i = 0; i < importando.itens.length; i += 200) { const { error } = await sb.from('compras').insert(importando.itens.slice(i, i + 200)); if (error) throw error; }
    } else {
      const mapa = new Map(S.clientes.filter(c => c.user_id !== S.uid).map(c => [keyNome(c.nome), c.id]));
      const novos = [...new Map(importando.itens.filter(x => !mapa.has(keyNome(x.nome))).map(x => [keyNome(x.nome), { nome: x.nome }])).values()];
      if (novos.length) { const { data, error } = await sb.from('clientes').insert(novos).select(); if (error) throw error; data.forEach(c => mapa.set(keyNome(c.nome), c.id)); }
      const linhas = importando.itens.map(({ nome, ...x }) => ({ ...x, cliente_id: mapa.get(keyNome(nome)), origem: 'admin' }));
      for (let i = 0; i < linhas.length; i += 200) { const { error } = await sb.from('vendas').insert(linhas.slice(i, i + 200)); if (error) throw error; }
    }
    toast(`${importando.itens.length} registros importados.`); importando = null; $('#impPrev').innerHTML = ''; $('#impArq').value = ''; await carregar();
  } catch (err) { toast(erroTexto(err)); btn.disabled = false; btn.textContent = 'Tentar de novo'; }
});

/* =================== navegação e render =================== */
const VIEWS = ['painel', 'vender', 'comprar', 'vendas', 'ajustes'];
function show(v) {
  if (!VIEWS.includes(v)) v = 'painel';
  VIEWS.forEach(x => { $('#v-' + x).hidden = x !== v; });
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  window.scrollTo(0, 0); tipEl().hidden = true;
  if (v === 'painel') renderDash();
}
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

function renderClientesDatalist() {
  $('#dlClientes').innerHTML = S.clientes.filter(c => c.user_id !== S.uid).map(c => `<option value="${esc(c.nome)}">`).join('');
}
function renderAll() {
  renderAlertas(); renderStock(); renderOwed(); renderFeed(); renderVendas(); renderCompras(); renderVendaHints(); renderAjustes(); renderClientesDatalist();
  if (!$('#v-painel').hidden) renderDash();
}

$('#vData').value = hoje(); $('#cData').value = hoje();
montarPeriodo('dPer', S.dPer, renderDash);
montarPeriodo('lPer', S.lPer, renderVendas);
renderCompraResumo();
show(location.hash.slice(1));
