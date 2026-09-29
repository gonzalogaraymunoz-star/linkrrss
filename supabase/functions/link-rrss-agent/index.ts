import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const ZERNIO_BASE = "https://zernio.com/api";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-link-agent-key,x-link-agent-id",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function timingSafeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function requireAgent(admin: any, req: Request, action: string) {
  const supplied = String(req.headers.get("x-link-agent-key") || "");
  const agentId = String(req.headers.get("x-link-agent-id") || "chatgpt-supabase-bridge");
  if (!supplied) throw Object.assign(new Error("Credencial LINK Agent requerida."), { status: 401 });

  const { data: row, error } = await admin
    .from("link_rrss_agent_credentials")
    .select("id,label,vault_secret_id,scopes,active")
    .eq("label", agentId)
    .maybeSingle();
  if (error || !row || row.active !== true) {
    throw Object.assign(new Error("LINK Agent no autorizado."), { status: 403 });
  }

  const { data: expected, error: secretError } = await admin.rpc("link_rrss_read_secret", {
    p_secret_id: row.vault_secret_id
  });
  if (secretError || !expected || !timingSafeEqual(supplied, String(expected))) {
    throw Object.assign(new Error("Credencial LINK Agent inválida."), { status: 403 });
  }

  const requiredScope =
    action === "media.upload" || action === "post.publish" ? "publish" :
    action === "account.resolve" || action === "post.lookup" ? "sync" :
    null;
  if (!requiredScope || !Array.isArray(row.scopes) || !row.scopes.includes(requiredScope)) {
    throw Object.assign(new Error("Acción fuera del alcance de LINK Agent."), { status: 403 });
  }

  await admin
    .from("link_rrss_agent_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return row;
}

async function zernioPost(apiKey: string, path: string, body: Record<string, unknown>, extraHeaders: Record<string,string> = {}) {
  const response = await fetch(ZERNIO_BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const err: any = new Error(payload?.error?.message || payload?.error || payload?.message || `Zernio ${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function readSourceSecret(admin: any, sourceId: string) {
  const { data: source, error } = await admin
    .from("link_rrss_sources")
    .select("id,profile_id,vault_secret_id,status,label,external_profile_id")
    .eq("id", sourceId)
    .single();
  if (error || !source?.vault_secret_id) {
    throw Object.assign(new Error("Fuente Zernio sin credencial."), { status: 404 });
  }
  const { data: secret, error: secretError } = await admin.rpc("link_rrss_read_secret", {
    p_secret_id: source.vault_secret_id
  });
  if (secretError || !secret) {
    throw Object.assign(new Error("No se pudo abrir la credencial segura de Zernio."), { status: 500 });
  }
  return { source, apiKey: String(secret) };
}

async function resolveAccount(admin: any, body: any) {
  const businessValue = String(body.business || body.business_id || body.business_slug || "").trim();
  const username = String(body.username || "").trim().replace(/^@/, "");
  const platform = String(body.platform || "instagram").trim().toLowerCase();

  let businessQuery = admin.from("link_world_businesses").select("id,name,slug");
  if (/^[0-9a-f-]{36}$/i.test(businessValue)) businessQuery = businessQuery.eq("id", businessValue);
  else businessQuery = businessQuery.eq("slug", businessValue);
  const { data: business, error: businessError } = await businessQuery.maybeSingle();
  if (businessError || !business) throw Object.assign(new Error("Negocio LINK no encontrado."), { status: 404 });

  const { data: profiles, error: profileError } = await admin
    .from("link_rrss_profiles")
    .select("id")
    .eq("business_id", business.id);
  if (profileError) throw profileError;
  const profileIds = (profiles || []).map((x: any) => x.id);
  if (!profileIds.length) throw Object.assign(new Error("Negocio sin perfil RRSS."), { status: 404 });

  const { data: sources, error: sourceError } = await admin
    .from("link_rrss_sources")
    .select("id")
    .in("profile_id", profileIds)
    .eq("provider", "zernio");
  if (sourceError) throw sourceError;
  const sourceIds = (sources || []).map((x: any) => x.id);
  if (!sourceIds.length) throw Object.assign(new Error("Negocio sin fuente Zernio."), { status: 404 });

  let accountQuery = admin
    .from("link_rrss_accounts")
    .select("id,source_id,external_account_id,platform,username,display_name,status,can_post,last_synced_at")
    .in("source_id", sourceIds)
    .ilike("platform", platform);
  if (username) accountQuery = accountQuery.ilike("username", username);
  const { data: accounts, error: accountError } = await accountQuery;
  if (accountError) throw accountError;
  const account = (accounts || [])[0];
  if (!account) throw Object.assign(new Error("Cuenta RRSS no encontrada."), { status: 404 });

  return {
    business,
    source_id: account.source_id,
    account_id: account.id,
    external_account_id: account.external_account_id,
    platform: account.platform,
    username: account.username,
    display_name: account.display_name,
    status: account.status,
    can_post: account.can_post,
    last_synced_at: account.last_synced_at
  };
}

async function persistCreatedPost(admin: any, account: any, created: any, fallbackContent: string, mediaUrl: string, mediaType: string) {
  const target = (created?.platforms || []).find((p: any) =>
    String(p?.accountId?._id || p?.accountId?.id || p?.accountId || "") === String(account.external_account_id)
  ) || created?.platforms?.[0] || {};

  const externalId = String(
    target?.platformPostId || created?.platformPostId || created?.id || created?._id || ""
  );
  if (!externalId) return null;

  const now = new Date().toISOString();
  const postUrl = target?.platformPostUrl || created?.platformPostUrl || created?.permalink || null;
  const publishedAt = created?.publishedAt || created?.createdAt || now;
  const row = {
    account_id: account.id,
    external_post_id: externalId,
    platform_post_id: target?.platformPostId || created?.platformPostId || created?.id || null,
    status: created?.status || target?.status || null,
    media_type: created?.mediaProductType || created?.mediaType || mediaType,
    content: created?.content || created?.caption || fallbackContent || null,
    thumbnail_url: created?.thumbnailUrl || created?.thumbnail || mediaUrl,
    post_url: postUrl,
    published_at: publishedAt,
    scheduled_for: created?.scheduledFor || null,
    metrics: created?.analytics || created?.metrics || {},
    raw: created || {},
    last_seen_at: now,
    updated_at: now
  };
  await admin.from("link_rrss_posts").upsert(row, { onConflict: "account_id,external_post_id" });
  await admin.from("link_rrss_activity_cache").insert({
    account_id: account.id,
    activity_type: "publication",
    external_id: externalId,
    occurred_at: publishedAt,
    payload: {
      post_id: externalId,
      text: row.content,
      media_type: mediaType,
      thumbnail: row.thumbnail_url,
      url: postUrl,
      source: "link-agent"
    }
  }).catch(() => null);
  return { external_id: externalId, post_url: postUrl, published_at: publishedAt };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST requerido." }, 405);

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const admin = adminClient();
    await requireAgent(admin, req, action);

    if (action === "account.resolve") {
      return json({ ok: true, account: await resolveAccount(admin, body) });
    }

    if (action === "media.upload") {
      const sourceId = String(body.source_id || "");
      const filename = String(body.filename || "").trim();
      const contentType = String(body.content_type || "").trim().toLowerCase();
      const encoded = String(body.base64_data || "").trim();
      if (!sourceId || !filename || !contentType || !encoded) {
        return json({ ok: false, error: "source_id, filename, content_type y base64_data son obligatorios." }, 400);
      }
      if (!["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime"].includes(contentType)) {
        return json({ ok: false, error: "Tipo de archivo no soportado." }, 400);
      }
      const clean = encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
      let bytes: Uint8Array;
      try {
        const binary = atob(clean);
        bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      } catch {
        return json({ ok: false, error: "El archivo no pudo decodificarse." }, 400);
      }
      if (!bytes.byteLength) return json({ ok: false, error: "Archivo vacío." }, 400);
      if (bytes.byteLength > 25 * 1024 * 1024) return json({ ok: false, error: "Archivo mayor a 25 MB." }, 413);

      const { apiKey } = await readSourceSecret(admin, sourceId);
      const presigned = await zernioPost(apiKey, "/v1/media/presign", {
        filename,
        contentType,
        size: bytes.byteLength
      });
      const uploadUrl = String(presigned?.uploadUrl || "");
      const publicUrl = String(presigned?.publicUrl || "");
      if (!uploadUrl || !publicUrl) throw Object.assign(new Error("Zernio no devolvió URLs de subida válidas."), { status: 502 });

      const uploaded = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: bytes
      });
      if (!uploaded.ok) {
        const detail = await uploaded.text().catch(() => "");
        return json({ ok: false, error: "No se pudo subir el archivo a Zernio.", detail }, 502);
      }
      return json({ ok: true, public_url: publicUrl, key: presigned?.key || null, expires_in: presigned?.expiresIn || null });
    }

    if (action === "post.publish") {
      const sourceId = String(body.source_id || "");
      const localAccountId = String(body.account_id || "");
      const content = String(body.content || "").trim();
      const mediaUrl = String(body.media_url || "").trim();
      const mediaType = String(body.media_type || "image").trim().toLowerCase();
      if (!sourceId || !localAccountId || !mediaUrl) {
        return json({ ok: false, error: "source_id, account_id y media_url son obligatorios." }, 400);
      }
      if (!mediaUrl.startsWith("https://")) return json({ ok: false, error: "media_url debe ser HTTPS." }, 400);

      const { apiKey } = await readSourceSecret(admin, sourceId);
      const { data: account, error: accountError } = await admin
        .from("link_rrss_accounts")
        .select("id,source_id,external_account_id,platform,username,status,can_post")
        .eq("id", localAccountId)
        .eq("source_id", sourceId)
        .single();
      if (accountError || !account) return json({ ok: false, error: "Cuenta RRSS no encontrada." }, 404);
      if (account.status !== "connected" || account.can_post === false) {
        return json({ ok: false, error: "La cuenta no está habilitada para publicar." }, 409);
      }

      const idempotencyKey = String(body.idempotency_key || crypto.randomUUID());
      const payload = {
        content,
        mediaItems: [{ type: mediaType, url: mediaUrl }],
        platforms: [{
          platform: String(account.platform || "").toLowerCase(),
          accountId: String(account.external_account_id)
        }],
        publishNow: true
      };

      const data = await zernioPost(apiKey, "/v1/posts", payload, { "Idempotency-Key": idempotencyKey });
      const created = data?.post || data;
      const persisted = created ? await persistCreatedPost(admin, account, created, content, mediaUrl, mediaType) : null;

      return json({
        ok: true,
        data,
        post_id: created?._id || created?.id || persisted?.external_id || null,
        status: created?.status || null,
        platform_post_url: persisted?.post_url || null
      });
    }

    if (action === "post.lookup") {
      const accountId = String(body.account_id || "");
      const contentLike = String(body.content_like || "").trim();
      if (!accountId) return json({ ok: false, error: "account_id obligatorio." }, 400);
      let q = admin.from("link_rrss_posts")
        .select("id,external_post_id,status,content,post_url,published_at,updated_at")
        .eq("account_id", accountId)
        .order("published_at", { ascending: false })
        .limit(20);
      if (contentLike) q = q.ilike("content", `%${contentLike}%`);
      const { data, error } = await q;
      if (error) throw error;
      return json({ ok: true, posts: data || [] });
    }

    return json({ ok: false, error: "Acción LINK Agent no habilitada." }, 403);
  } catch (error: any) {
    return json({
      ok: false,
      error: error?.message || "Error inesperado.",
      detail: error?.payload || null
    }, Number(error?.status || 500));
  }
});
