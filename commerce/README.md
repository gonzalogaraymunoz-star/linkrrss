# LINK Commerce · registro de negocios y websites de adquisición

**Estado:** v0.2 de validación interna. Alojado en Cloudflare Workers con datos reales de LINK CONTROL CENTRAL, sin modificar las webs externas.

## Qué es

LINK Commerce es un **aparato opcional** de LINK WORLD. Se organiza **cuenta por cuenta**, como LINK RRSS, pero la unidad es el comercio. **No construye websites**: las registra, organiza y enlaza. Las webs se crean en sus propios repositorios y sistemas.

Flujo de esta etapa: `LINK WORLD business → activar cuenta Commerce → asociar websites → registrar adquisición`. La transferencia automática a LINK Ventas/Hotel Experience, FIN y Operaciones se deja expresamente fuera de v0.2.

## Infraestructura

- **Cloudflare Worker:** `link-commerce`, URL `https://link-commerce.gonzalogaraymunoz.workers.dev/`. En producción de prueba desde la API de Cloudflare, **no** mediante CI.
- **Supabase LINK CONTROL CENTRAL** (proyecto `zgbnjlrxzvzpigmwidsp`): `link_world_businesses` es el catálogo existente de negocios. Se reutiliza el identificador de negocio. Las tablas nuevas son `link_commerce_accounts`, `link_commerce_sites` y `link_commerce_acquisitions`.
- **GitHub:** este directorio es una rama aislada en `linkrrss` para reutilizar patrones de UX y no afectar producción. **El repositorio independiente `link-commerce` aún no se ha creado** porque la conexión GitHub actual no permite crear repositorios. Esta rama NO despliega automáticamente.

## Autorización

El Worker autentica con Supabase Auth (correo y contraseña). La API usa exclusivamente el JWT de la sesión del usuario y la **publishable key** de Supabase; no incluye una service-role key. Toda escritura queda sometida a RLS. Solo miembros activos `owner` y `admin` pueden activar cuentas y registrar websites o adquisiciones. No hay registro público ni sincronizaciones periódicas.

Los cuatro sitios de referencia importados del campo `link_world_businesses.website` tienen `kind=reference` y `status=registered`: **no se consideran webs de adquisición verificadas**. Ningún negocio fue activado automáticamente como Commerce.

## API de esta fase

| Método | Ruta | Comportamiento |
|---|---|---|
| GET | `/api/health` | Salud del Worker; no expone negocios |
| POST | `/api/auth/login` | Inicio de sesión Supabase |
| POST | `/api/auth/refresh` | Renovación del token |
| GET | `/api/bootstrap` | Negocios, cuentas activadas, sites y adquisiciones con RLS |
| POST | `/api/accounts` | Activar Commerce para un business ID existente |
| PATCH | `/api/accounts/:id` | Pausar/reactivar la cuenta |
| POST | `/api/sites` | Registrar website HTTPS de negocio activo |
| PATCH | `/api/sites/:id` | Editar o pausar website |
| POST | `/api/acquisitions` | Registrar manualmente una solicitud real; solo autorizado |

La API de entrada desde websites públicas **aún no está activada**. Para esa integración faltan por sitio: autenticación segura backend-to-backend / firma, protección antiabuso, verificación de propiedad, idempotencia, consentimiento y mapeo al contrato LINK Ventas. No incrustar credenciales de escritura en el HTML de los comercios.

## Principios de UX

- Selector de negocios como LINK RRSS, sin menú lateral fijo.
- Comercio opt-in: activar solo donde tenga sentido.
- Cada cuenta abre su ficha, directorio de websites y adquisición.
- Acceso externo directo a la website; no se edita desde el panel.
- Paleta The Architectural Ledger: `#FBF9F9`, `#EFEDED`, `#1B1C1C`, `#C8FF3D`.
- No hay pedidos, stock, checkout, reservas operativas, dinero, ventas ni operaciones duplicados en este proyecto.

## Reproducción

El código fuente desplegado del Worker está en `commerce/worker.js`; el entorno debe disponer de las bindings `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. La política de accesos y el esquema actual ya fueron migrados mediante Supabase MCP. Guardar posteriores cambios con nuevas migraciones versionadas y verificar el despliegue/flujo autenticado antes de habilitar un negocio real.

> **Pendientes prioritarios:** repositorio independiente y GitHub → Cloudflare CI/CD; pruebas end-to-end con sesión real; verificación automática de websites; API firmada de adquisición pública; derivación a LINK Ventas.
