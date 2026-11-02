// Tela de login compartilhada: Google ou e-mail e senha.
import { sb, $, esc, toast, erroTexto, NOME_LOJA } from './lib.js';

const G_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>`;

const voltarPara = () => location.origin + location.pathname;

export function montarLogin(el, { titulo, sub }) {
  el.innerHTML = `
  <div class="auth">
    <div class="hero"><span class="egg"></span><h1>${esc(titulo)}</h1><p class="sub">${esc(sub)}</p></div>
    <div class="authcard" id="aCard">
      <button type="button" class="btn gbtn block" id="aGoogle">${G_ICON}Entrar com Google</button>
      <div class="sep">ou com e-mail e senha</div>
      <div class="filters" role="tablist">
        <button type="button" class="chip" data-modo="entrar" aria-pressed="true">Entrar</button>
        <button type="button" class="chip" data-modo="criar" aria-pressed="false">Criar conta</button>
      </div>
      <form id="aForm" novalidate>
        <div class="field" data-so="criar" hidden><label for="aNome">Seu nome</label><input type="text" id="aNome" autocomplete="name"></div>
        <div class="field" data-so="criar" hidden><label for="aTel">WhatsApp</label><input type="tel" id="aTel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999"></div>
        <div class="field"><label for="aEmail">E-mail</label><input type="email" id="aEmail" autocomplete="email" inputmode="email"></div>
        <div class="field"><label for="aSenha">Senha</label><input type="password" id="aSenha" autocomplete="current-password" minlength="6"></div>
        <button type="submit" class="btn yolk block" id="aEnviar">Entrar</button>
        <button type="button" class="linkbtn" id="aEsqueci" data-so="entrar">Esqueci minha senha</button>
      </form>
    </div>
    <div class="authcard" id="aNova" hidden>
      <b>Crie uma senha nova</b>
      <form id="aNovaForm" novalidate>
        <div class="field"><label for="aNovaSenha">Nova senha</label><input type="password" id="aNovaSenha" autocomplete="new-password" minlength="6"></div>
        <button type="submit" class="btn yolk block">Salvar senha</button>
      </form>
    </div>
    <p class="hint" style="text-align:center">${esc(NOME_LOJA)} · seus dados ficam visíveis só para você e para a vendedora.</p>
  </div>`;

  let modo = 'entrar';
  const setModo = m => {
    modo = m;
    el.querySelectorAll('[data-modo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modo === m ? 'true' : 'false'));
    el.querySelectorAll('[data-so]').forEach(x => x.hidden = x.dataset.so !== m);
    $('#aEnviar').textContent = m === 'criar' ? 'Criar conta' : 'Entrar';
    $('#aSenha').autocomplete = m === 'criar' ? 'new-password' : 'current-password';
  };
  el.querySelector('[role=tablist]').addEventListener('click', e => { const b = e.target.closest('[data-modo]'); if (b) setModo(b.dataset.modo); });

  $('#aGoogle').addEventListener('click', async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: voltarPara() } });
    if (error) toast(erroTexto(error));
  });

  $('#aForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#aEmail').value.trim(), senha = $('#aSenha').value;
    if (!email || !senha) { toast('Preencha e-mail e senha.'); return; }
    const btn = $('#aEnviar'); btn.disabled = true;
    try {
      if (modo === 'entrar') {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      } else {
        const nome = $('#aNome').value.trim();
        if (!nome) { toast('Escreva seu nome.'); $('#aNome').focus(); return; }
        if (senha.length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.'); return; }
        const { data, error } = await sb.auth.signUp({ email, password: senha,
          options: { data: { nome, telefone: $('#aTel').value.trim() }, emailRedirectTo: voltarPara() } });
        if (error) throw error;
        if (!data.session) {
          $('#aCard').innerHTML = `<b>Confira seu e-mail</b><p style="margin:0">Mandamos um link de confirmação para <b>${esc(email)}</b>. Clique nele para ativar sua conta. Se não chegar em alguns minutos, olhe a caixa de spam.</p>`;
        }
      }
    } catch (err) { toast(erroTexto(err)); }
    finally { btn.disabled = false; }
  });

  $('#aEsqueci').addEventListener('click', async () => {
    const email = $('#aEmail').value.trim();
    if (!email) { toast('Escreva seu e-mail acima e toque de novo em "Esqueci minha senha".'); $('#aEmail').focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: voltarPara() });
    toast(error ? erroTexto(error) : 'Se esse e-mail tiver conta, chega um link para criar senha nova.');
  });

  $('#aNovaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const senha = $('#aNovaSenha').value;
    if (senha.length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.'); return; }
    const { error } = await sb.auth.updateUser({ password: senha });
    if (error) { toast(erroTexto(error)); return; }
    toast('Senha nova salva.'); location.replace(voltarPara());
  });
}

export function mostrarNovaSenha() {
  const c = $('#aCard'), n = $('#aNova');
  if (c) c.hidden = true; if (n) { n.hidden = false; $('#aNovaSenha').focus(); }
}
