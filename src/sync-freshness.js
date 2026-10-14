// LINK RRSS · frescura por módulo; el pulso de mensajes no valida publicaciones.
export function snapshotExpired(snap,now=Date.now()){
  const expiry=Date.parse(snap?.stale_after||'');
  return !Number.isFinite(expiry)||expiry<=now;
}
export function contentRefreshDue(content,analytics,{now=Date.now(),lastAttempt=0,retryDelayMs=120000}={}){
  if(lastAttempt && now-lastAttempt<retryDelayMs)return false;
  return snapshotExpired(content,now)||snapshotExpired(analytics,now);
}
export function snapshotLabel(snap,now=Date.now()){
  if(!snap)return 'Sin datos recientes';
  if(snap.status==='blocked')return 'Permiso pendiente';
  if(snap.status==='error'||snap.status==='partial')return 'Error de actualización';
  if(snapshotExpired(snap,now))return 'Desactualizado';
  if(snap.status==='empty')return 'Sin novedades';
  return 'Al día';
}
