import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotExpired,contentRefreshDue,snapshotLabel} from '../src/sync-freshness.js';
const now=Date.parse('2026-10-14T18:16:00Z');
const fresh={status:'ok',fetched_at:'2026-10-14T18:15:00Z',stale_after:'2026-10-14T18:25:00Z'};
const old={status:'ok',fetched_at:'2026-10-08T23:01:00Z',stale_after:'2026-10-08T23:11:00Z'};
test('el pulso de mensajes no hace que contenido antiguo se considere actualizado',()=>{
  assert.equal(snapshotExpired(old,now),true);
  assert.equal(snapshotLabel(old,now),'Desactualizado');
  assert.equal(contentRefreshDue(old,fresh,{now}),true);
});
test('dos módulos recientes no requieren refrescar',()=>{
  assert.equal(contentRefreshDue(fresh,fresh,{now}),false);
  assert.equal(snapshotLabel(fresh,now),'Al día');
});
test('un intento reciente evita reintentos automáticos en bucle',()=>{
  assert.equal(contentRefreshDue(old,old,{now,lastAttempt:now-1000}),false);
  assert.equal(contentRefreshDue(old,old,{now,lastAttempt:now-180000}),true);
});
test('los errores y bloqueos nunca se presentan como al día',()=>{
  assert.equal(snapshotLabel({...fresh,status:'error'},now),'Error de actualización');
  assert.equal(snapshotLabel({...fresh,status:'blocked'},now),'Permiso pendiente');
  assert.equal(snapshotLabel(null,now),'Sin datos recientes');
});
