# Caracol · piloto de adquisición probado (2026-10-10)

## Flujo funcional
Enlace `https://link-commerce-caracol.gonzalogaraymunoz.workers.dev/?source=instagram` → formulario web → POST `/api/intake` → Worker Cloudflare → RPC `link_commerce_caracol_intake` → `link_commerce_acquisitions` y `link_commerce_attribution_events`.

La RPC exige un secreto de alta entropía, cuya huella se almacena en el esquema privado y cuyo valor solo se configura como binding secreto del Worker. La interfaz no recibe ese secreto. Se valida la longitud de campos, el canal y la referencia. Se limita a 10 solicitudes por minuto para el piloto. Las tablas conservan sus políticas RLS.

El registro del sitio en LINK Commerce está vinculado al perfil LINK RRSS del mismo negocio Caracol. No se ha modificado la website externa oficial de Caracol ni se ha conectado su cuenta de Instagram para publicar el enlace automáticamente.

## Evidencia
- Browser Rendering de Cloudflare envió POST real y recibió HTTP 201 con adquisición `d31e1db9-9710-4bb9-ab71-05ae8d977730`.
- Supabase confirmó la adquisición, su evento `9d720006-3253-4531-8f91-ba0efc4dddaa`, canal Instagram y perfil RRSS Caracol.
- Dos registros sintéticos quedaron marcados `metadata.test=true` y `metadata.synthetic=true`.
- Worker `link-commerce-caracol` desplegado con workers.dev habilitado; `GET /api/health` devolvió `ok:true`.

## Alcance y pendientes
Es un **piloto de captura real**, no un checkout, una reserva confirmada ni una integración automática de Instagram. No se ha probado la publicación en RRSS ni el traspaso a LINK Ventas. La ficha piloto no incluye todavía un método de contacto, así que no se recomienda para campañas públicas hasta agregar contacto, consentimiento, antispam adicional e idempotencia. La URL no debe publicarse como formulario comercial definitivo.

La relación estructural y la captura sí quedaron probadas punta a punta, desde un navegador hasta Supabase.
