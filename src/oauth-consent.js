import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './connection.js';
import './oauth-consent.css';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = id => document.getElementById(id);
const authorizationId = new URLSearchParams(location.search).get('authorization_id');
const message = text => { $('message').textContent = text; };
const fail = text => { message(text); $('approve').disabled = true; };

async function load() {
  if (!authorizationId) return fail('Falta la referencia de autorización. Abre nuevamente la conexión desde ChatGPT.');
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) {
    $('intro').textContent = 'Entra con tu cuenta de LINK CONTROL CENTRAL para revisar la solicitud.';
    $('login').hidden = false;
    return;
  }
  const { data: member, error: memberError } = await db.rpc('link_world_is_member');
  if (memberError || member !== true) return fail('Esta cuenta no tiene acceso a LINK WORLD.');
  const { data, error: detailsError } = await db.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsError) return fail('No se pudo verificar la solicitud: ' + detailsError.message);
  if (data?.redirect_url && !('authorization_id' in data)) {
    location.assign(data.redirect_url);
    return;
  }
  if (!data) return fail('No hay una solicitud de autorización vigente.');
  $('client').textContent = data.client?.name || 'Aplicación sin nombre';
  $('scopes').textContent = data.scope || 'Acceso solicitado por el cliente';
  $('destination').textContent = data.redirect_uri || data.client?.redirect_uri || 'Destino registrado en Supabase';
  $('intro').textContent = 'Revisa quién solicita acceso antes de continuar.';
  $('consent').hidden = false;
}

async function decide(approve) {
  $('approve').disabled = true;
  $('deny').disabled = true;
  message(approve ? 'Autorizando…' : 'Rechazando…');
  const result = approve
    ? await db.auth.oauth.approveAuthorization(authorizationId)
    : await db.auth.oauth.denyAuthorization(authorizationId);
  if (result.error || !result.data?.redirect_url) {
    message('No se pudo completar: ' + (result.error?.message || 'respuesta incompleta'));
    $('approve').disabled = false;
    $('deny').disabled = false;
    return;
  }
  location.assign(result.data.redirect_url);
}

$('login').addEventListener('submit', async event => {
  event.preventDefault();
  message('Entrando…');
  const { error } = await db.auth.signInWithPassword({
    email: $('email').value.trim(), password: $('password').value
  });
  $('password').value = '';
  if (error) return message('No se pudo entrar: ' + error.message);
  $('login').hidden = true;
  await load();
});
$('approve').addEventListener('click', () => decide(true));
$('deny').addEventListener('click', () => decide(false));
load().catch(() => fail('No se pudo comprobar la solicitud. Intenta conectar de nuevo.'));
