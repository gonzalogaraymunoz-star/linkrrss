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

## Deploy

Importar este repositorio como proyecto Vercel `linkrrss`. Vite se detecta automáticamente.
