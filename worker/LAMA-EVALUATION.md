# LAMA evaluation only

Dedicated Worker: lama-intake-agent.
Deployment: npx wrangler deploy --config worker/lama-wrangler.jsonc

This does not activate CRM intake. It has no Supabase credential, customer data, messaging tool, payment tool or reservation tool. GET returns health only. The scheduled handler contains fixed synthetic cases and is invoked manually for evaluation; no cron is configured. The AI binding uses the existing Workers Free plan and stops on its platform limit. Do not upgrade billing or use a paid-only model.

Inspect JSON/source evidence and quality before replacing this evaluation handler with a scoped automatic consumer. Do not use the global ComunEscucha claim/complete path or impersonate human review flags. Preserve the canonical knowledge and source revisions in Supabase.
