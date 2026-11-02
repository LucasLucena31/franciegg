// Funções compartilhadas entre a área da cliente e a área da vendedora.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, NOME_LOJA } from './config.js';

export { NOME_LOJA };
export const configurado = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('COLE-A-CHAVE');
export const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const TIPOS = [{ k: 'extra', n: 'Extra' }, { k: 'jumbo', n: 'Jumbo' }, { k: 'vermelho', n: 'Vermelho' }];
export const FORMATOS = [
  { k: 'caixa', n: 'Caixa', sub: '12 cartelas', mult: 12, lbl: 'Quantas caixas?' },
  { k: 'meia', n: 'Meia caixa', sub: '6 cartelas', mult: 6, lbl: 'Quantas meias caixas?' },
  { k: 'cartela', n: 'Cartela', sub: 'avulsa', mult: 1, lbl: 'Quantas cartelas?' },
  { k: 'personalizado', n: 'Personalizado', sub: 'você digita', mult: 1, lbl: 'Quantas cartelas no total?' }];

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const moneyField = n => n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function parseMoney(s) {
  if (s == null) return null; s = String(s).trim().replace(/[R$\s]/g, ''); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
export function hoje() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
export function fmtData(iso) {
  if (!iso) return ''; iso = String(iso).slice(0, 10); const y = iso.slice(0, 4);
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + (y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : '');
}
export const keyNome = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
export const plural = (n, s, p) => n === 1 ? s : p;
export const tipoNome = k => (TIPOS.find(t => t.k === k) || { n: k }).n;
export const formatoNome = k => (FORMATOS.find(f => f.k === k) || { n: k }).n;
export const totalCartelas = v => TIPOS.reduce((s, t) => s + (Number(v[t.k]) || 0), 0);
export const sortDesc = (a, b) => String(b.data || '').localeCompare(String(a.data || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

export function itensTexto(v) {
  const p = TIPOS.filter(t => v[t.k] > 0).map(t => `${v[t.k]} ${plural(v[t.k], 'cartela', 'cartelas')} ${t.n}`);
  return p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p[p.length - 1] : (p[0] || '');
}
export function itensHTML(v) {
  return TIPOS.filter(t => v[t.k] > 0).map(t => `<span class="it"><span class="egg dot-${t.k}"></span>${v[t.k]} ${t.n}</span>`).join('');
}

// Telefone
export const soDigitos = s => String(s || '').replace(/\D/g, '');
export function telWa(s) { let d = soDigitos(s).replace(/^0+/, ''); if (!d) return ''; if (d.length === 10 || d.length === 11) d = '55' + d; return d; }
export function fmtTel(s) {
  let d = soDigitos(s); if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// Avisos rápidos
let toastT = null;
export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600);
}
export function erroTexto(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/User already registered/i.test(m)) return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com a internet. Confira e tente de novo.';
  if (/row-level security|permission denied/i.test(m)) return 'Sua conta não tem permissão para isso.';
  if (/mime|file type|invalid_mime/i.test(m)) return 'Esse arquivo não é aceito. Use foto (JPG ou PNG) ou PDF.';
  if (/maximum allowed size|too large|Payload too large/i.test(m)) return 'O arquivo é grande demais (máximo 5 MB).';
  return m && m.length < 160 ? m : 'Algo deu errado. Tente de novo.';
}

// Comprovante: reduz fotos antes de enviar
export async function comprimir(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
}
export async function enviarComprovante(file, pasta) {
  let blob = file, type = file.type || '', ext = 'jpg';
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) { type = 'application/pdf'; ext = 'pdf'; }
  else {
    try { blob = await comprimir(file); type = 'image/jpeg'; }
    catch (_) { if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('Esse arquivo não é aceito. Use foto (JPG ou PNG) ou PDF.'); ext = type.split('/')[1]; }
  }
  const path = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('comprovantes').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}
export async function abrirComprovante(path) {
  const { data, error } = await sb.storage.from('comprovantes').createSignedUrl(path, 600);
  if (error) { toast(erroTexto(error)); return; }
  if (/\.pdf$/i.test(path)) { window.open(data.signedUrl, '_blank', 'noopener'); return; }
  let lb = $('#lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.id = 'lightbox';
    lb.innerHTML = '<button type="button" class="btn small" id="lbFechar">Fechar</button><img id="lbImg" alt="Comprovante">';
    document.body.appendChild(lb);
    lb.addEventListener('click', e => { if (e.target.id !== 'lbImg') lb.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.hidden = true; });
  }
  $('#lbImg').src = data.signedUrl; lb.hidden = false; $('#lbFechar').focus();
}

// ---------------------------------------------------------------------
// Pix "copia e cola" (BR Code estático, padrão do Banco Central)
// ---------------------------------------------------------------------
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
export function crc16(s) {
  let crc = 0xFFFF;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function normalizarChavePix(tipo, chave) {
  const c = String(chave || '').trim();
  if (tipo === 'cpf') return soDigitos(c);
  if (tipo === 'celular') { let d = soDigitos(c); if (d.length === 10 || d.length === 11) d = '55' + d; return d ? '+' + d : ''; }
  if (tipo === 'email') return c.toLowerCase();
  return c;
}
export function pixCopiaECola({ chave, nome, cidade, valor, txid }) {
  const limpa = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().trim();
  let p = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', chave)) + tlv('52', '0000') + tlv('53', '986');
  if (valor > 0) p += tlv('54', Number(valor).toFixed(2));
  p += tlv('58', 'BR') + tlv('59', limpa(nome).slice(0, 25).trim() || 'VENDEDORA') + tlv('60', limpa(cidade).slice(0, 15).trim() || 'SAO PAULO');
  p += tlv('62', tlv('05', (String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***'));
  p += '6304';
  return p + crc16(p);
}
export function qrDataUrl(texto) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
  return q.createDataURL(5, 2);
}
export async function copiar(texto, el) {
  try { await navigator.clipboard.writeText(texto); toast('Código Pix copiado. Cole no app do banco.'); }
  catch (_) { if (el) { el.focus(); el.select(); } toast('Selecione o código e copie.'); }
}
