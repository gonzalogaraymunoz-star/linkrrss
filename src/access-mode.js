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
