# LINK RRSS · Informes para ChatGPT

## Referencia y adaptación

Metricool separa un conector MCP que entrega datos y un agente que hace el informe. Su método:
1. métricas del período;
2. publicaciones destacadas y patrones;
3. comparación con período anterior;
4. resumen para el cliente y próxima recomendación.

LINK usa el mismo recorrido, sumando la ficha y los compromisos de cada negocio en LINK WORLD. Zernio conserva la verdad de cuentas y actividad social; el contrato permanece en LINK WORLD. Este repositorio expone únicamente una proyección de lectura. No copia mensajes ni credenciales a ChatGPT.

## Herramientas MCP de la primera versión

- `list_social_businesses`: negocios y estado social.
- `get_social_report_data`: negocio + rango ISO; cuentas, compromisos, publicaciones observadas, señales de inbox y vigencia de cada módulo.

La ruta pública prevista es `https://linkrrss.vercel.app/mcp`. El servidor exige OAuth de Supabase y membresía LINK WORLD. Esta aplicación incluye una pantalla de consentimiento en `/oauth/consent`. Para completar la conexión hay que habilitar **Supabase Auth OAuth 2.1 Server**, configurar Authorization Path `/oauth/consent` y activar el registro de clientes o registrar ChatGPT. **Antes de tocar Site URL**, comprobar su valor actual y sus flujos existentes: Supabase forma la URL de consentimiento con Site URL + Authorization Path. Si Site URL apunta a LINK WORLD, la pantalla de consentimiento debe servirse allí; cambiar Site URL a `linkrrss.vercel.app` sin migrar los flujos existentes puede afectar otros inicios de sesión. Usamos el scope `email`; Supabase documenta refresh tokens, pero ChatGPT advierte que un proveedor sin `offline_access` anunciado podría requerir volver a autorizar al expirar la sesión. En septiembre de 2026, el endpoint OAuth del proyecto LINK responde 404: no se debe declarar el conector operativo hasta completar y probar esa configuración.

## Método de informe en ChatGPT

Pedir primero el negocio exacto y fijar zona horaria, período actual y período anterior. Llamar a `get_social_report_data` para cada período. Redactar:

1. **Conclusión ejecutiva**, con fuente y fecha de lectura.
2. **Entrega frente al plan**: compromisos activos y evidencia de piezas vinculadas; si no hay vínculo, avance desconocido.
3. **Rendimiento observado**: formatos, publicaciones destacadas y métricas realmente presentes.
4. **Comparación**: cambios porcentuales solo cuando ambos períodos tienen datos completos y comparables.
5. **Comunidad**: mensajes pendientes observados, siempre con alcance de la página consultada y sin revelar conversaciones.
6. **Decisión siguiente**: máximo tres acciones verificables, con responsable y fecha si se conocen.
7. **Calidad de datos**: fecha de capturas, módulos vencidos, páginas faltantes, métricas no disponibles.

El informe completo puede generarse como HTML autónomo desde ChatGPT, con gráfico y tabla, sin cargar servicios externos ni incrustar datos personales. LINK WORLD recibe un bloque breve: estado, plan, avance verificado, señal y próxima acción. El enlace al informe completo se agrega solo después de guardar el artefacto y verificar permisos.

## Contrato Caracol

La ficha actual contiene **8 reels mensuales**, **4 piezas complementarias**, stories/comunidad y revisión mensual. LINK RRSS tiene una cuenta Instagram conectada en Zernio. Sus capturas son páginas de resultados y caducan; una página de 25 posts o 30 conversaciones no representa el total mensual. Un post se contabiliza contra el compromiso solo después de registrar una correspondencia verificable entre el ID externo y el compromiso, que todavía no existe.

## Reglas de integridad

- `connected` significa conexión de cuenta; `stale` indica vigencia de la captura. Son estados distintos.
- No comparar likes, alcance, impresiones y tasas como si fueran la misma métrica.
- No calcular engagement rate sin una definición de denominador y datos de alcance/impresiones.
- No atribuir una mejora a hora, tono o formato sin evidencia comparativa suficiente.
- Un DM no prueba lead ni venta. No usar texto de mensajes en informes compartibles.
- Las acciones de programar, publicar, contestar y registrar leads quedan fuera de esta primera versión de lectura.

## Verificación antes de conectar ChatGPT

1. OAuth discovery devuelve metadatos válidos y el usuario LINK da consentimiento.
2. `/mcp` rechaza peticiones anónimas y usuarios ajenos.
3. Una sesión autorizada enumera Caracol y lee solo los datos permitidos.
4. Un período con capturas vencidas muestra su fecha; una página parcial no produce totales.
5. ChatGPT genera un informe con cifras rastreables y lo revisa en vista móvil y escritorio.
