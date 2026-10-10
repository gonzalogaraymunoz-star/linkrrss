# LINK RRSS ↔ LINK Commerce · Flow v0.3

## Implementado
- Fuente canónica de negocios: `link_world_businesses.id` (no se crean negocios duplicados).
- Relación explícita entre perfiles LINK RRSS y websites LINK Commerce: `link_commerce_rrss_links`.
- Eventos de atribución: `link_commerce_attribution_events` con business, site, perfil RRSS, publicación y adquisición opcionales; los triggers rechazan referencias entre negocios distintos.
- Vista administrativa `link_commerce_rrss_flow_v` con RLS por invocador.
- Vistas públicas de datos comerciales **reducidos**: `link_commerce_public_businesses_v`, `link_commerce_rrss_public_flow_v`, `link_commerce_public_sites_v`, `link_commerce_public_profiles_v`, `link_commerce_public_links_v`. No exponen mensajes, teléfonos, correos, tokens ni datos personales.
- Worker público `GET /api/public/flow` y pantalla cuenta por cuenta que muestra perfiles, sitios, conexiones y el estado de la frontera de adquisición.
- Relación existente registrada para LAMA Travelers: perfil LINK RRSS ↔ website de referencia. **No significa captación automática verificada.**

## Frontera de seguridad
La pantalla pública es solo consulta. Las tablas privadas mantienen RLS; no hay endpoint público de escritura. La vista pública muestra únicamente metadatos comerciales permitidos. Las operaciones sensibles requieren una sesión válida y rol autorizado. No se publica ninguna credencial privilegiada.

## Pendiente para cerrar el circuito transaccional
1. Verificar la propiedad de cada website y conectar su backend con autenticación servidor a servidor.
2. Emitir enlaces trazables por publicación y canal con identificadores opacos, sin exponer información personal.
3. Registrar eventos con protección antiabuso, idempotencia, política de retención y consentimiento cuando corresponda.
4. Vincular el evento de adquisición al contrato de LINK Ventas y probar el traspaso sin duplicados.
5. Pruebas end-to-end de autenticación y recepción real desde una website.

**Importante:** v0.3 es el puente estructural y su visualización. Todavía no captura automáticamente pedidos desde Instagram ni desde websites externas.
