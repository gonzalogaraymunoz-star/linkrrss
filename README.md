# LINK RRSS

Aparato transversal de redes sociales de LINK WORLD.

## Arquitectura

LINK WORLD → negocio → perfil RRSS → fuente Zernio → cuentas → actividad → señales LINK.

La aplicación usa el Supabase canónico de LINK WORLD para identidad, estado y permisos. Las credenciales Zernio no se almacenan en el navegador: el Edge Function `link-rrss-zernio` valida la sesión LINK, guarda la API key en Supabase Vault y actúa como proxy de lectura hacia Zernio.

## Flujo

- Si un negocio no tiene aparato RRSS, LINK WORLD ofrece **Generar misión RRSS**.
- Si existe un perfil/conexión, LINK WORLD ofrece **Abrir panel RRSS**.
- Dentro de LINK RRSS se puede añadir una fuente Zernio.
- La fuente descubre automáticamente sus cuentas sociales.
- Inbox, contenido, analytics y automatizaciones se consultan bajo demanda.

## Desarrollo

```bash
npm install
npm run dev
```

## ChatGPT · informes LINK RRSS

El endpoint de lectura MCP y el método de informes están descritos en
[`docs/LINK_SOCIAL_REPORTS.md`](docs/LINK_SOCIAL_REPORTS.md). La autenticación
OAuth 2.1 de Supabase debe quedar habilitada y probada antes de conectar
el endpoint en ChatGPT. La presencia del código no significa que la app
ya esté autorizada o publicada en ChatGPT.

## Deploy

Importar este repositorio como proyecto Vercel `linkrrss`. Vite se detecta automáticamente.
