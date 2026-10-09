# LINK Commerce · Modelo constitutivo

LINK RRSS y LINK Commerce son aparatos paralelos de adquisición. LINK ID identifica negocio, persona y artefacto; RRSS distribuye contenido y conversa; Commerce alberga websites comerciales tipificadas; una solicitud válida genera un evento de adquisición; LINK Ventas gestiona la oportunidad y el cierre; Operaciones ejecuta.

Cada artefacto Commerce debe registrar: business_id, artifact_id, nombre, tipología, objetivo, URL, canal de origen, producto/servicio, estado, evento de conversión esperado, datos mínimos, destino de la adquisición y versión.

Tipologías iniciales: landing, catálogo, formulario de contacto, solicitud de cotización, pedido y reserva. Un clic o visita no equivale a una adquisición.

Contrato de adquisición: event_id, business_id, artifact_id, link_id (si existe), source, campaign, requested_service, contact_method, occurred_at, status. Idempotencia por event_id y trazabilidad de origen.

Fase inicial: directorio y tipificación. No crear automáticamente ventas, reservas, pagos ni operaciones. La recepción pública requiere validación, control antiabuso y protección de datos. Mantener la API privada protegida aunque el directorio sea público.
