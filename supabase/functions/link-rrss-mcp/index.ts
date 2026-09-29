import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@^2.0.0";
import { pipeline } from "npm:@supabase/middleware@^0.5.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@^1.6.0";
import { z } from "npm:zod@^4.3.6";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const AGENT_ID = "chatgpt-supabase-bridge";

function adminClient() {
  return createClient(
    PROJECT_URL,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function requireLinkMember(supabase: any) {
  const { data, error } = await supabase.rpc("link_world_is_member");
  if (error || data !== true) {
    throw new Error("La cuenta autenticada no es un miembro activo de LINK.");
  }
}

async function machineCredential(admin: any) {
  const { data: row, error } = await admin
    .from("link_rrss_agent_credentials")
    .select("label,vault_secret_id,active")
    .eq("label", AGENT_ID)
    .eq("active", true)
    .maybeSingle();

  if (error || !row?.vault_secret_id) {
    throw new Error("Credencial interna LINKRRSS no disponible.");
  }

  const { data: secret, error: secretError } = await admin.rpc("link_rrss_read_secret", {
    p_secret_id: row.vault_secret_id
  });

  if (secretError || !secret) {
    throw new Error("No se pudo abrir la credencial interna LINKRRSS.");
  }
  return String(secret);
}

async function callLinkAgent(admin: any, payload: Record<string, unknown>) {
  const secret = await machineCredential(admin);
  const response = await fetch(`${PROJECT_URL}/functions/v1/link-rrss-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-link-agent-id": AGENT_ID,
      "x-link-agent-key": secret
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { ok: false, error: "Respuesta LINKRRSS no válida.", raw: text }; }

  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.error || `LINKRRSS respondió HTTP ${response.status}`);
  }
  return data;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

const OpenAIFile = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
});

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "LINKRRSS",
          version: "1.0.0"
        });

        server.registerTool(
          "resolve_social_account",
          {
            description: "Resolve a social account already connected inside LINKRRSS. Use before publishing when you need to verify the business, username, connection state, and posting permission.",
            inputSchema: z.object({
              business: z.string().min(1).describe("LINK business slug or UUID, for example caracol"),
              platform: z.string().min(1).default("instagram"),
              username: z.string().min(1).describe("Social username with or without @")
            }),
            annotations: {
              readOnlyHint: true,
              openWorldHint: false,
              destructiveHint: false
            }
          },
          async ({ business, platform, username }) => {
            await requireLinkMember(supabase);
            const data = await callLinkAgent(adminClient(), {
              action: "account.resolve",
              business,
              platform,
              username
            });
            return {
              content: [{ type: "text", text: JSON.stringify(data) }]
            };
          }
        );

        server.registerTool(
          "publish_social_post",
          {
            description: "Publish the exact file supplied by the user through LINKRRSS. LINKRRSS resolves its stored Zernio credential, uploads the media to Zernio, publishes it to the already-connected social account, persists the result, and returns the platform URL when available. Never use this tool to bypass LINKRRSS or to connect a new social account.",
            inputSchema: z.object({
              business: z.string().min(1).describe("LINK business slug or UUID"),
              platform: z.string().min(1).default("instagram"),
              username: z.string().min(1).describe("Target username with or without @"),
              caption: z.string().max(10000),
              file: OpenAIFile
            }),
            annotations: {
              readOnlyHint: false,
              openWorldHint: true,
              destructiveHint: true
            },
            _meta: {
              "openai/fileParams": ["file"],
              "openai/toolInvocation/invoking": "Publicando mediante LINKRRSS…",
              "openai/toolInvocation/invoked": "LINKRRSS procesó la publicación"
            }
          } as any,
          async ({ business, platform, username, caption, file }) => {
            await requireLinkMember(supabase);
            const admin = adminClient();

            const resolved = await callLinkAgent(admin, {
              action: "account.resolve",
              business,
              platform,
              username
            });
            const account = resolved?.account;
            if (!account?.source_id || !account?.account_id) {
              throw new Error("LINKRRSS no pudo resolver la cuenta de destino.");
            }
            if (account.status !== "connected" || account.can_post === false) {
              throw new Error("La cuenta existe en LINKRRSS pero no está habilitada para publicar.");
            }

            const fileResponse = await fetch(file.download_url);
            if (!fileResponse.ok) {
              throw new Error(`No se pudo leer el archivo adjunto de ChatGPT (HTTP ${fileResponse.status}).`);
            }

            const bytes = new Uint8Array(await fileResponse.arrayBuffer());
            if (!bytes.byteLength) throw new Error("El archivo adjunto está vacío.");
            if (bytes.byteLength > 25 * 1024 * 1024) {
              throw new Error("LINKRRSS limita la carga directa a 25 MB.");
            }

            const contentType = String(
              file.mime_type ||
              fileResponse.headers.get("content-type") ||
              "application/octet-stream"
            ).split(";")[0].trim().toLowerCase();

            const allowed = new Set([
              "image/jpeg", "image/png", "image/gif", "image/webp",
              "video/mp4", "video/quicktime"
            ]);
            if (!allowed.has(contentType)) {
              throw new Error(`Tipo de archivo no soportado por LINKRRSS: ${contentType}`);
            }

            const filename = file.file_name || `chatgpt-${file.file_id}`;
            const uploaded = await callLinkAgent(admin, {
              action: "media.upload",
              source_id: account.source_id,
              filename,
              content_type: contentType,
              base64_data: bytesToBase64(bytes)
            });

            const mediaUrl = uploaded?.public_url;
            if (!mediaUrl) throw new Error("LINKRRSS no recibió la URL de media desde Zernio.");

            const mediaType =
              contentType === "image/gif" ? "gif" :
              contentType.startsWith("video/") ? "video" :
              "image";

            const idempotencyKey =
              `linkrrss-chatgpt:${file.file_id}:${account.account_id}:${caption.length}`;

            const published = await callLinkAgent(admin, {
              action: "post.publish",
              source_id: account.source_id,
              account_id: account.account_id,
              content: caption,
              media_url: mediaUrl,
              media_type: mediaType,
              idempotency_key: idempotencyKey
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  route: "ChatGPT -> LINKRRSS -> Zernio -> " + account.platform,
                  business: account.business,
                  account: {
                    platform: account.platform,
                    username: account.username,
                    display_name: account.display_name
                  },
                  file_id: file.file_id,
                  post_id: published?.post_id || null,
                  status: published?.status || null,
                  platform_post_url: published?.platform_post_url || null
                })
              }]
            };
          }
        );

        server.registerTool(
          "lookup_social_post",
          {
            description: "Look up recent persisted posts for a LINKRRSS account to verify publication status and retrieve the platform URL.",
            inputSchema: z.object({
              business: z.string().min(1),
              platform: z.string().min(1).default("instagram"),
              username: z.string().min(1),
              content_like: z.string().optional()
            }),
            annotations: {
              readOnlyHint: true,
              openWorldHint: false,
              destructiveHint: false
            }
          },
          async ({ business, platform, username, content_like }) => {
            await requireLinkMember(supabase);
            const admin = adminClient();
            const resolved = await callLinkAgent(admin, {
              action: "account.resolve",
              business,
              platform,
              username
            });
            const account = resolved?.account;
            const data = await callLinkAgent(admin, {
              action: "post.lookup",
              account_id: account.account_id,
              content_like: content_like || ""
            });
            return {
              content: [{ type: "text", text: JSON.stringify(data) }]
            };
          }
        );

        return server;
      });

      return handler.fetch(req);
    }
  )
);
