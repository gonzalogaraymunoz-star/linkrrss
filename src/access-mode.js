// Explicit, URL-scoped mode. No persistent setting or permission changes.
export function manualUpdateMode(search='') {
  return new URLSearchParams(search).get('update_mode')==='manual';
}
export function accessFallback(error,hasSession=false) {
  if(!error)return null;
  const status=Number(error.status||error.statusCode||0);
  const denied=[401,403].includes(status)||error.code==='42501';
  return denied?(hasSession?'denied':'login'):null;
}
export function manualActionAllowed(action) {
  return action==='pulse.sync'||action==='sync.inbox'||action==='zernio.get';
}

// Passwordless sign-in only. Never creates a user or changes a password.
export function memberEmailLinkRequest(email,href) {
  const current=new URL(href);
  const business=current.searchParams.get('business');
  if(!business||!business.trim())throw new Error('Abre primero el enlace del negocio que quieres consultar.');
  const callback=new URL(current.origin+'/');
  callback.searchParams.set('business',business);
  callback.searchParams.set('section','inbox');
  callback.searchParams.set('update_mode','manual');
  return {email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:callback.href}};
}
