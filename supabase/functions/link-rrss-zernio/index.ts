import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const ZERNIO_BASE = "https://zernio.com/api";
const READ_PREFIXES = [
  "/v1/accounts", "/v1/profiles", "/v1/posts", "/v1/analytics", "/v1/inbox/",
  "/v1/workflows", "/v1/comment-automations", "/v1/sequences", "/v1/ads/",
  "/v1/logs", "/v1/queue", "/v1/tracking-tags", "/v1/instagram/",
  "/v1/contacts", "/v1/reviews"
];
const CONNECT_PLATFORMS = new Set([
  "facebook","instagram","linkedin","twitter","tiktok","youtube","threads",
  "reddit","pinterest","bluesky","googlebusiness","telegram","snapchat",
  "discord","slack","whatsapp"
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function rows(payload: any, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}
function profileIdOf(v: any) {
  return String(v?.profileId || v?.profile_id || v?.profile?._id || v?.profile?.id || "");
}
function errorInfo(error: any) {
  const message = String(error?.message || error?.payload?.error || "Error");
  const lower = message.toLowerCase();
  let requiredGroup: string | null = null;
  for (const group of ["messages","engagement","ads","webhooks"]) {
    if (lower.includes("'" + group + "'") || lower.includes('"' + group + '"') || lower.includes(" " + group + " ")) {
      requiredGroup = group; break;
    }
  }
  return {
    message,
    status: Number(error?.status || 500),
    code: error?.payload?.code || error?.payload?.error?.code || null,
    required_group: requiredGroup
  };
}

async function zernioGet(apiKey: string, path: string, query: Record<string, unknown> = {}) {
  const url = new URL(ZERNIO_BASE + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
  });
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const error: any = new Error(payload?.error?.message || payload?.error || payload?.message || `Zernio ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}


async function zernioPost(apiKey: string, path: string, body: Record<string, unknown> = {}, extraHeaders: Record<string,string> = {}) {
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
    const error: any = new Error(payload?.error?.message || payload?.error || payload?.message || `Zernio ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function requireMember(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw Object.assign(new Error("Sesión LINK requerida."), { status: 401 });
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: ok, error } = await userClient.rpc("link_world_is_member");
  if (error || ok !== true) throw Object.assign(new Error("Miembro LINK requerido."), { status: 403 });
}
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function readSourceSecret(admin: any, sourceId: string) {
  const { data: source, error } = await admin
    .from("link_rrss_sources")
    .select("id,profile_id,vault_secret_id,status,label,external_profile_id,metadata")
    .eq("id", sourceId)
    .single();
  if (error || !source?.vault_secret_id) throw Object.assign(new Error("Fuente Zernio sin credencial."), { status: 404 });
  const { data: secret, error: secretError } = await admin.rpc("link_rrss_read_secret", { p_secret_id: source.vault_secret_id });
  if (secretError || !secret) throw Object.assign(new Error("No se pudo abrir la credencial segura."), { status: 500 });
  return { source, apiKey: secret as string };
}

async function sourceContext(admin: any, sourceId: string) {
  const { source, apiKey } = await readSourceSecret(admin, sourceId);
  const { data: profile, error } = await admin
    .from("link_rrss_profiles")
    .select("id,business_id,status")
    .eq("id", source.profile_id)
    .single();
  if (error || !profile) throw new Error("Perfil RRSS no encontrado.");
  return { source, profile, businessId: profile.business_id, apiKey };
}

async function cacheSnapshot(admin: any, args: {
  businessId: string, sourceId?: string | null, accountId?: string | null,
  module: string, payload?: any, status?: string, error?: string | null, ttlMinutes?: number
}) {
  const scope = args.accountId || args.sourceId || "business";
  const cacheKey = `${args.businessId}:${scope}:${args.module}`;
  const ttl = Math.max(1, args.ttlMinutes || 5);
  const staleAfter = new Date(Date.now() + ttl * 60000).toISOString();
  const row = {
    cache_key: cacheKey,
    business_id: args.businessId,
    source_id: args.sourceId || null,
    account_id: args.accountId || null,
    module: args.module,
    status: args.status || "ok",
    payload: args.payload ?? {},
    error: args.error || null,
    fetched_at: new Date().toISOString(),
    stale_after: staleAfter,
    updated_at: new Date().toISOString()
  };
  const { error } = await admin.from("link_rrss_snapshots").upsert(row, { onConflict: "cache_key" });
  if (error) throw error;
  return row;
}


async function cacheActivity(admin: any, args: {
  accountId: string,
  activityType: string,
  externalId?: string | null,
  occurredAt?: string | null,
  payload?: any
}) {
  const row = {
    account_id: args.accountId,
    activity_type: args.activityType,
    external_id: args.externalId || null,
    occurred_at: args.occurredAt || new Date().toISOString(),
    payload: args.payload || {}
  };
  if (row.external_id) {
    const { data: existing } = await admin.from("link_rrss_activity_cache")
      .select("id").eq("account_id",row.account_id)
      .eq("activity_type",row.activity_type)
      .eq("external_id",row.external_id).maybeSingle();
    if (existing?.id) {
      await admin.from("link_rrss_activity_cache").update({
        occurred_at: row.occurred_at,
        payload: row.payload
      }).eq("id",existing.id);
      return;
    }
  }
  await admin.from("link_rrss_activity_cache").insert(row);
}


function persistentPostRecord(post: any, externalAccountId: string) {
  const platforms = Array.isArray(post?.platforms) ? post.platforms : [];
  const target = platforms.find((p:any)=>{
    const v=p?.accountId?._id || p?.accountId?.id || p?.accountId;
    return String(v||"")===String(externalAccountId||"");
  }) || platforms[0] || {};
  const externalPostId = String(
    target?.platformPostId || post?.platformPostId || post?.id || post?._id || ""
  );
  if (!externalPostId) return null;
  const metrics = {
    ...(target?.analytics || {}),
    ...(post?.analytics || {}),
    ...(post?.metrics || {})
  } as any;
  if (post?.likeCount !== undefined && metrics.likes === undefined) metrics.likes = Number(post.likeCount || 0);
  if (post?.commentCount !== undefined && metrics.comments === undefined) metrics.comments = Number(post.commentCount || 0);
  if (post?.shareCount !== undefined && metrics.shares === undefined) metrics.shares = Number(post.shareCount || 0);
  if (post?.saveCount !== undefined && metrics.saves === undefined) metrics.saves = Number(post.saveCount || 0);
  const publishedAt = post?.publishedAt || post?.createdTime || post?.createdAt || post?.scheduledFor || null;
  return {
    external_post_id: externalPostId,
    platform_post_id: target?.platformPostId || post?.platformPostId || post?.id || null,
    status: post?.status || target?.status || null,
    media_type: post?.mediaProductType || post?.mediaType || post?.type || null,
    content: post?.content || post?.message || post?.caption || post?.text || null,
    thumbnail_url: post?.thumbnailUrl || post?.thumbnail || post?.picture || post?.mediaItems?.[0]?.thumbnail || null,
    post_url: post?.platformPostUrl || post?.permalink || target?.platformPostUrl || null,
    published_at: publishedAt,
    scheduled_for: post?.scheduledFor || null,
    metrics,
    raw: post || {}
  };
}

async function persistPosts(admin: any, account: any, posts: any[]) {
  const normalized = (posts || []).map(p=>persistentPostRecord(p,account.external_account_id)).filter(Boolean) as any[];
  if (!normalized.length) return { count:0 };
  const ids = normalized.map(x=>x.external_post_id);
  const { data: existing } = await admin.from("link_rrss_posts")
    .select("external_post_id,metrics,content,thumbnail_url,post_url,published_at,scheduled_for,status,media_type")
    .eq("account_id",account.id).in("external_post_id",ids);
  const previous = new Map((existing || []).map((x:any)=>[String(x.external_post_id),x]));
  const now = new Date().toISOString();
  const records = normalized.map((x:any)=>{
    const old:any = previous.get(String(x.external_post_id)) || {};
    return {
      account_id:account.id,
      external_post_id:x.external_post_id,
      platform_post_id:x.platform_post_id || old.platform_post_id || null,
      status:x.status || old.status || null,
      media_type:x.media_type || old.media_type || null,
      content:x.content || old.content || null,
      thumbnail_url:x.thumbnail_url || old.thumbnail_url || null,
      post_url:x.post_url || old.post_url || null,
      published_at:x.published_at || old.published_at || null,
      scheduled_for:x.scheduled_for || old.scheduled_for || null,
      metrics:{...(old.metrics||{}),...(x.metrics||{})},
      raw:x.raw || {},
      last_seen_at:now,
      updated_at:now
    };
  });
  const { data: saved, error } = await admin.from("link_rrss_posts")
    .upsert(records,{onConflict:"account_id,external_post_id"})
    .select("id,external_post_id,metrics");
  if (error) throw error;
  const day = now.slice(0,10);
  const history=(saved||[]).filter((x:any)=>x?.id && x?.metrics && Object.keys(x.metrics).length).map((x:any)=>({
    post_id:x.id,observed_on:day,observed_at:now,metrics:x.metrics
  }));
  if(history.length){
    const {error:hError}=await admin.from("link_rrss_post_metric_history").upsert(history,{onConflict:"post_id,observed_on"});
    if(hError) throw hError;
  }
  return {count:records.length};
}

async function persistConversations(admin:any, account:any, conversations:any[]){
  if(!conversations?.length) return {count:0,rows:[]};
  const now=new Date().toISOString();
  const records=conversations.map((c:any)=>{
    const id=String(c?.id || c?._id || "");
    if(!id) return null;
    return {
      account_id:account.id,
      external_conversation_id:id,
      participant_id:c?.participantId || null,
      participant_name:c?.participantName || c?.participantUsername || c?.username || null,
      participant_username:c?.participantUsername || c?.username || null,
      participant_picture:c?.participantPicture || null,
      platform_url:c?.url || null,
      status:c?.status || "active",
      unread_count:Number(c?.unreadCount || 0),
      last_message:typeof c?.lastMessage==="string" ? c.lastMessage : (c?.lastMessage?.text || c?.lastMessageText || c?.preview || null),
      last_message_at:c?.updatedTime || c?.updatedAt || c?.lastMessageAt || null,
      raw:c || {},
      last_seen_at:now,
      updated_at:now
    };
  }).filter(Boolean);
  const {data:saved,error}=await admin.from("link_rrss_conversations")
    .upsert(records,{onConflict:"account_id,external_conversation_id"})
    .select("id,external_conversation_id");
  if(error) throw error;
  return {count:records.length,rows:saved||[]};
}

async function persistMessages(admin:any, conversationId:string, messages:any[]){
  if(!conversationId || !messages?.length) return {count:0,incoming:0,outgoing:0,unknown:0};
  const now=new Date().toISOString();
  const records=messages.map((m:any)=>{
    const externalMessageId=String(m?.id || m?._id || "");
    if(!externalMessageId) return null;
    const direction=["incoming","outgoing"].includes(String(m?.direction||"").toLowerCase())
      ? String(m.direction).toLowerCase()
      : "unknown";
    return {
      conversation_id:conversationId,
      external_message_id:externalMessageId,
      direction,
      sender_id:m?.senderId || null,
      sender_name:m?.senderName || null,
      message:typeof m?.message==="string" ? m.message : (m?.text || null),
      attachments:Array.isArray(m?.attachments)?m.attachments:[],
      delivery_status:m?.deliveryStatus || null,
      sent_via:m?.sentVia || null,
      platform_created_at:m?.createdAt || m?.sentAt || null,
      raw:m || {},
      last_seen_at:now,
      updated_at:now
    };
  }).filter(Boolean);
  if(!records.length) return {count:0,incoming:0,outgoing:0,unknown:0};
  const {error}=await admin.from("link_rrss_messages")
    .upsert(records,{onConflict:"conversation_id,external_message_id"});
  if(error) throw error;
  return {
    count:records.length,
    incoming:records.filter((x:any)=>x.direction==="incoming").length,
    outgoing:records.filter((x:any)=>x.direction==="outgoing").length,
    unknown:records.filter((x:any)=>x.direction==="unknown").length
  };
}

async function refreshAccountMemory(admin:any, accountId:string, historyPatch:any={}){
  const [{count:postCount},{count:conversationCount},{data:bounds}] = await Promise.all([
    admin.from("link_rrss_posts").select("id",{count:"exact",head:true}).eq("account_id",accountId),
    admin.from("link_rrss_conversations").select("id",{count:"exact",head:true}).eq("account_id",accountId),
    admin.from("link_rrss_posts").select("published_at").eq("account_id",accountId).not("published_at","is",null).order("published_at",{ascending:true})
  ]);
  const dates=(bounds||[]).map((x:any)=>x.published_at).filter(Boolean);
  const now=new Date().toISOString();
  const row:any={
    account_id:accountId,
    post_count:Number(postCount||0),
    conversation_count:Number(conversationCount||0),
    earliest_post_at:dates[0]||null,
    latest_post_at:dates[dates.length-1]||null,
    last_successful_sync_at:now,
    updated_at:now,
    ...historyPatch
  };
  const {error}=await admin.from("link_rrss_account_memory").upsert(row,{onConflict:"account_id"});
  if(error) throw error;
  return row;
}

function isoDay(d:Date){return d.toISOString().slice(0,10);}
async function backfillAccountHistory(admin:any, apiKey:string, account:any, months=18){
  const {data:memory}=await admin.from("link_rrss_account_memory").select("history_backfilled_at").eq("account_id",account.id).maybeSingle();
  if(memory?.history_backfilled_at) return {skipped:true};
  await admin.from("link_rrss_account_memory").upsert({
    account_id:account.id,history_status:"backfilling",updated_at:new Date().toISOString()
  },{onConflict:"account_id"});
  let saved=0, successfulWindows=0;
  const now=new Date();
  for(let i=0;i<Math.max(1,Math.min(24,months));i++){
    const end=new Date(now.getFullYear(),now.getMonth()-i+1,0,23,59,59,999);
    if(end>now) end.setTime(now.getTime());
    const start=new Date(end.getFullYear(),end.getMonth(),1,0,0,0,0);
    const result=await safeFetch(apiKey,"/v1/analytics",{
      accountId:account.external_account_id,
      platform:account.platform,
      fromDate:isoDay(start),
      toDate:isoDay(end)
    });
    if(!result.ok) continue;
    successfulWindows++;
    const list=rows(result.data,["posts"]);
    const persisted=await persistPosts(admin,account,list);
    saved+=persisted.count;
  }
  const finished=new Date().toISOString();
  await refreshAccountMemory(admin,account.id,{
    history_backfilled_at:successfulWindows?finished:null,
    history_status:successfulWindows?"ready":"partial"
  });
  return {saved,successful_windows:successfulWindows};
}

async function syncAccounts(admin: any, sourceId: string, apiKey: string, externalProfileId?: string | null) {
  const accountQuery = externalProfileId ? { profileId: externalProfileId } : {};
  const [accountsPayload, healthPayload] = await Promise.all([
    zernioGet(apiKey, "/v1/accounts", accountQuery),
    zernioGet(apiKey, "/v1/accounts/health").catch(() => null)
  ]);
  const accounts = rows(accountsPayload, ["accounts"]);

  const healthRows = rows(healthPayload, ["accounts"]);
  const healthMap = new Map<string, any>();
  for (const h of healthRows) {
    const id = h.accountId || h.account_id || h.id || h._id;
    if (id) healthMap.set(String(id), h);
  }

  const keepIds: string[] = [];
  for (const account of accounts) {
    const externalId = String(account._id || account.id || account.accountId || account.account_id || "");
    if (!externalId) continue;
    keepIds.push(externalId);
    const health = healthMap.get(externalId) || {};
    const permissions = health.permissions || {};
    const row = {
      source_id: sourceId,
      external_account_id: externalId,
      platform: String(account.platform || health.platform || "unknown"),
      username: account.username || account.handle || health.username || null,
      display_name: account.displayName || account.display_name || health.displayName || null,
      status: health.status === "error" ? "error" : health.status === "warning" ? "warning" : "connected",
      can_post: permissions.canPost ?? health.canPost ?? null,
      can_analytics: permissions.canFetchAnalytics ?? health.canFetchAnalytics ?? null,
      metadata: { account, health },
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { error } = await admin.from("link_rrss_accounts").upsert(row, { onConflict: "source_id,external_account_id" });
    if (error) throw error;
  }

  if (keepIds.length) {
    await admin.from("link_rrss_accounts").delete().eq("source_id", sourceId).not("external_account_id", "in", `(${keepIds.map(x=>'"'+x.replaceAll('"','')+'"').join(",")})`);
  }

  await admin.from("link_rrss_sources").update({
    status: "healthy",
    last_synced_at: new Date().toISOString(),
    last_error: null,
    capabilities: { accounts: true, health: Boolean(healthPayload), oauth_connect: true },
    updated_at: new Date().toISOString()
  }).eq("id", sourceId);

  const { data: sourceRow } = await admin.from("link_rrss_sources").select("profile_id").eq("id", sourceId).single();
  if (sourceRow?.profile_id) {
    await admin.from("link_rrss_profiles").update({
      status: accounts.length ? "active" : "configuring",
      updated_at: new Date().toISOString()
    }).eq("id", sourceRow.profile_id);
  }

  return { accounts, health: healthPayload };
}

function sleep(ms:number){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function retryAfterMs(error:any,attempt:number){
  if(Number(error?.status)!==429) return 0;
  const message=String(error?.message||error?.payload?.error?.message||"");
  const match=message.match(/retry after\s+(\d+)\s+seconds?/i);
  const seconds=match?Number(match[1]):Math.min(4*(attempt+1),20);
  return Math.min(Math.max(seconds,1),30)*1000+350;
}

async function safeFetch(apiKey: string, path: string, query: Record<string, unknown> = {}) {
  let lastError:any=null;
  for(let attempt=0;attempt<3;attempt++){
    try {
      return { ok: true, data: await zernioGet(apiKey, path, query), error: null };
    } catch (error: any) {
      lastError=error;
      const wait=retryAfterMs(error,attempt);
      if(!wait || attempt===2) break;
      await sleep(wait);
    }
  }
  return { ok: false, data: null, error: errorInfo(lastError) };
}

async function fullSync(admin: any, businessId: string, trigger = "app_open") {
  const now = new Date().toISOString();
  await admin.from("link_rrss_workspace_state").upsert({
    business_id: businessId,
    last_sync_started_at: now,
    last_sync_status: "syncing",
    last_sync_error: null,
    updated_at: now
  }, { onConflict: "business_id" });

  const { data: run, error: runError } = await admin.from("link_rrss_sync_runs").insert({
    business_id: businessId,
    trigger,
    status: "running",
    modules: ["accounts","content","analytics","inbox","automations"],
    started_at: now
  }).select("id").single();
  if (runError) throw runError;

  const summary: any = { sources: 0, accounts: 0, modules: {}, blocked: [], errors: [] };
  let sourceForRun: string | null = null;

  try {
    const { data: profiles, error: profileError } = await admin
      .from("link_rrss_profiles").select("id").eq("business_id", businessId);
    if (profileError) throw profileError;
    const profileIds = (profiles || []).map((x:any)=>x.id);
    if (!profileIds.length) {
      await admin.from("link_rrss_sync_runs").update({
        status:"ok",summary:{...summary,note:"Sin perfil RRSS"},finished_at:new Date().toISOString()
      }).eq("id",run.id);
      await admin.from("link_rrss_workspace_state").update({
        last_sync_status:"ok",last_full_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq("business_id",businessId);
      return summary;
    }

    const { data: sources, error: sourceError } = await admin
      .from("link_rrss_sources").select("id,profile_id,external_profile_id,label").in("profile_id", profileIds);
    if (sourceError) throw sourceError;
    summary.sources = (sources || []).length;

    for (const s of (sources || [])) {
      sourceForRun = s.id;
      const { apiKey } = await readSourceSecret(admin, s.id);
      await syncAccounts(admin, s.id, apiKey, s.external_profile_id);

      const { data: localAccounts, error: accountError } = await admin
        .from("link_rrss_accounts").select("*").eq("source_id",s.id).order("platform");
      if (accountError) throw accountError;
      summary.accounts += (localAccounts || []).length;

      await cacheSnapshot(admin,{
        businessId,sourceId:s.id,module:"accounts",
        payload:{accounts:localAccounts||[]},status:(localAccounts||[]).length?"ok":"empty",ttlMinutes:5
      });

      for (const a of (localAccounts || [])) {
        const content = await safeFetch(apiKey,`/v1/accounts/${encodeURIComponent(a.external_account_id)}/posts`,{limit:30});
        await cacheSnapshot(admin,{
          businessId,sourceId:s.id,accountId:a.id,module:"content",
          payload:content.data||{},status:content.ok?(rows(content.data,["posts"]).length?"ok":"empty"):(content.error?.status===403?"blocked":"error"),
          error:content.ok?null:JSON.stringify(content.error),ttlMinutes:10
        });
        summary.modules.content = (summary.modules.content||0)+1;
        if (!content.ok) summary.errors.push({module:"content",account:a.username,error:content.error});
        if (content.ok) {
          const contentRows = rows(content.data,["posts"]);
          await persistPosts(admin,a,contentRows);
          for (const post of contentRows.slice(0,40)) {
            const postId = String(post?._id || post?.id || post?.platformPostId || post?.platforms?.[0]?.platformPostId || "");
            if (!postId) continue;
            const metrics = post?.analytics || post?.metrics || post?.platforms?.[0]?.analytics || {};
            const publishedAt = post?.publishedAt || post?.createdTime || post?.createdAt || post?.scheduledFor || new Date().toISOString();
            await cacheActivity(admin,{
              accountId:a.id,
              activityType:"publication",
              externalId:postId,
              occurredAt:publishedAt,
              payload:{
                post_id:postId,
                text:post?.content || post?.message || post?.caption || post?.text || "",
                media_type:post?.mediaType || post?.type || null,
                thumbnail:post?.thumbnailUrl || post?.thumbnail || post?.mediaItems?.[0]?.thumbnail || null,
                url:post?.platformPostUrl || post?.permalink || post?.platforms?.[0]?.platformPostUrl || null,
                metrics
              }
            });
            const metricStamp = String(metrics?.lastUpdated || post?.updatedAt || "");
            if (metricStamp && (Number(metrics?.likes||0)+Number(metrics?.comments||0)+Number(metrics?.shares||0)+Number(metrics?.saves||0)>0)) {
              await cacheActivity(admin,{
                accountId:a.id,
                activityType:"engagement",
                externalId:postId+":"+metricStamp,
                occurredAt:metricStamp,
                payload:{post_id:postId,text:post?.content || post?.message || post?.caption || "",metrics,url:post?.platformPostUrl || post?.permalink || post?.platforms?.[0]?.platformPostUrl || null}
              });
            }
          }
        }

        const analytics = await safeFetch(apiKey,"/v1/analytics",{accountId:a.external_account_id,platform:a.platform});
        await cacheSnapshot(admin,{
          businessId,sourceId:s.id,accountId:a.id,module:"analytics",
          payload:analytics.data||{},status:analytics.ok?"ok":(analytics.error?.status===403?"blocked":"error"),
          error:analytics.ok?null:JSON.stringify(analytics.error),ttlMinutes:10
        });
        summary.modules.analytics = (summary.modules.analytics||0)+1;
        if (!analytics.ok) summary.errors.push({module:"analytics",account:a.username,error:analytics.error});
        if (analytics.ok) await persistPosts(admin,a,rows(analytics.data,["posts"]));

        const inbox = await safeFetch(apiKey,"/v1/inbox/conversations",{
          accountId:a.external_account_id,platform:a.platform,limit:100,sortOrder:"desc"
        });
        const inboxStatus = inbox.ok ? (rows(inbox.data,["conversations"]).length?"ok":"empty") : (inbox.error?.status===403?"blocked":"error");
        await cacheSnapshot(admin,{
          businessId,sourceId:s.id,accountId:a.id,module:"inbox",
          payload:inbox.data||{},status:inboxStatus,
          error:inbox.ok?null:JSON.stringify(inbox.error),ttlMinutes:3
        });
        summary.modules.inbox = (summary.modules.inbox||0)+1;
        const messageSync={conversations:0,messages:0,incoming:0,outgoing:0,unknown:0,errors:0};
        if (inbox.ok) {
          const conversations = rows(inbox.data,["conversations"]);
          const persisted=await persistConversations(admin,a,conversations);
          const localByExternal=new Map((persisted.rows||[]).map((row:any)=>[String(row.external_conversation_id),String(row.id)]));
          for (const c of conversations.slice(0,100)) {
            const conversationId = String(c?.id || c?._id || "");
            const stamp = String(c?.updatedTime || c?.updatedAt || c?.lastMessageAt || "");
            if (!conversationId) continue;
            if(stamp){
              await cacheActivity(admin,{
                accountId:a.id,
                activityType:"message",
                externalId:conversationId+":"+stamp,
                occurredAt:stamp,
                payload:{
                  conversation_id:conversationId,
                  participant_id:c?.participantId || null,
                  participant_name:c?.participantName || c?.participantUsername || c?.username || "Contacto",
                  participant_username:c?.participantUsername || c?.username || null,
                  participant_picture:c?.participantPicture || null,
                  message:typeof c?.lastMessage==="string"?c.lastMessage:(c?.lastMessage?.text || c?.lastMessageText || c?.preview || ""),
                  unread_count:Number(c?.unreadCount || 0),
                  status:c?.status || "active",
                  url:c?.url || null
                }
              });
            }
          }

          const inboxBatchSize=String(a.platform||"").toLowerCase()==="whatsapp"?2:4;
          const inboxBatchPauseMs=String(a.platform||"").toLowerCase()==="whatsapp"?700:250;
          for(let i=0;i<conversations.length;i+=inboxBatchSize){
            const batch=conversations.slice(i,i+inboxBatchSize);
            await Promise.all(batch.map(async(c:any)=>{
              const externalConversationId=String(c?.id || c?._id || "");
              const localConversationId=localByExternal.get(externalConversationId);
              if(!externalConversationId || !localConversationId) return;
              const history=await safeFetch(
                apiKey,
                `/v1/inbox/conversations/${encodeURIComponent(externalConversationId)}/messages`,
                {accountId:a.external_account_id,limit:100,sortOrder:"desc"}
              );
              if(!history.ok){
                messageSync.errors++;
                if(history.error?.required_group) summary.blocked.push({module:"inbox_messages",required_group:history.error.required_group});
                else summary.errors.push({module:"inbox_messages",account:a.username,conversation:externalConversationId,error:history.error});
                return;
              }
              messageSync.conversations++;
              const persistedMessages=await persistMessages(admin,localConversationId,rows(history.data,["messages"]));
              messageSync.messages+=persistedMessages.count;
              messageSync.incoming+=persistedMessages.incoming;
              messageSync.outgoing+=persistedMessages.outgoing;
              messageSync.unknown+=persistedMessages.unknown;
            }));
            if(i+inboxBatchSize<conversations.length) await sleep(inboxBatchPauseMs);
          }
          summary.modules.inbox_messages=(summary.modules.inbox_messages||0)+messageSync.messages;
          await cacheSnapshot(admin,{
            businessId,sourceId:s.id,accountId:a.id,module:"inbox_messages",
            payload:messageSync,status:messageSync.errors?"partial":"ok",
            error:messageSync.errors?JSON.stringify({errors:messageSync.errors}):null,ttlMinutes:3
          });
        }
        if (!inbox.ok) {
          if (inbox.error?.required_group) summary.blocked.push({module:"inbox",required_group:inbox.error.required_group});
          else summary.errors.push({module:"inbox",account:a.username,error:inbox.error});
        }

        const capabilityPayload = {
          account_id:a.external_account_id,
          platform:a.platform,
          can_post:a.can_post,
          can_analytics:a.can_analytics,
          inbox: inbox.ok,
          inbox_message_history: messageSync.messages>0,
          inbox_message_direction: (messageSync.incoming+messageSync.outgoing)>0,
          inbox_messages_synced: messageSync.messages,
          inbox_required_group: inbox.error?.required_group || null
        };
        await cacheSnapshot(admin,{
          businessId,sourceId:s.id,accountId:a.id,module:"capabilities",
          payload:capabilityPayload,status:"ok",ttlMinutes:30
        });
        await refreshAccountMemory(admin,a.id);
      }

      const [wf,ca,seq] = await Promise.all([
        safeFetch(apiKey,"/v1/workflows",{limit:50}),
        safeFetch(apiKey,"/v1/comment-automations",{limit:50}),
        safeFetch(apiKey,"/v1/sequences",{limit:50})
      ]);
      const automationPayload = { workflows:wf, comment_automations:ca, sequences:seq };
      const blocked = [wf,ca,seq].filter((x:any)=>!x.ok && x.error?.status===403);
      await cacheSnapshot(admin,{
        businessId,sourceId:s.id,module:"automations",
        payload:automationPayload,status:blocked.length?"blocked":"ok",
        error:blocked.length?JSON.stringify(blocked.map((x:any)=>x.error)):null,ttlMinutes:10
      });
      summary.modules.automations = (summary.modules.automations||0)+1;
      for (const x of blocked) if (x.error?.required_group) summary.blocked.push({module:"automations",required_group:x.error.required_group});
    }

    const partial = summary.errors.length>0 || summary.blocked.length>0;
    const finished = new Date().toISOString();
    await admin.from("link_rrss_sync_runs").update({
      source_id:sourceForRun,
      status:partial?"partial":"ok",
      summary,
      finished_at:finished
    }).eq("id",run.id);
    await admin.from("link_rrss_workspace_state").upsert({
      business_id:businessId,
      last_full_sync_at:finished,
      last_sync_status:partial?"partial":"ok",
      last_sync_error:summary.errors.length?JSON.stringify(summary.errors):null,
      module_state:summary,
      updated_at:finished
    },{onConflict:"business_id"});
    return summary;
  } catch(error:any) {
    const finished = new Date().toISOString();
    const info = errorInfo(error);
    await admin.from("link_rrss_sync_runs").update({
      source_id:sourceForRun,status:"error",error:JSON.stringify(info),summary,finished_at:finished
    }).eq("id",run.id);
    await admin.from("link_rrss_workspace_state").upsert({
      business_id:businessId,last_sync_status:"error",last_sync_error:JSON.stringify(info),updated_at:finished
    },{onConflict:"business_id"});
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireMember(req);
    const body = await req.json();
    const action = String(body?.action || "");
    const admin = adminClient();

    if (action === "source.preview") {
      const apiKey = String(body.api_key || "").trim();
      if (!apiKey) return json({ ok:false, error:"API key obligatoria." }, 400);
      try {
        const [profilesPayload, accountsPayload] = await Promise.all([
          zernioGet(apiKey, "/v1/profiles"),
          zernioGet(apiKey, "/v1/accounts")
        ]);
        const profiles = rows(profilesPayload, ["profiles"]).map((p:any)=>({
          id:String(p._id || p.id || ""),
          name:p.name || p.label || p.title || "Perfil",
          is_default:Boolean(p.default || p.isDefault || p.is_default)
        })).filter((p:any)=>p.id);
        const accounts = rows(accountsPayload, ["accounts"]).map((a:any)=>({
          id:String(a._id || a.id || a.accountId || ""),
          profile_id:profileIdOf(a),
          platform:a.platform || "unknown",
          username:a.username || a.handle || null,
          display_name:a.displayName || a.display_name || null
        }));
        return json({ok:true,profiles,accounts});
      } catch(error:any) {
        return json({ok:false,error:"La API key no pudo autenticarse contra Zernio.",detail:error.payload||error.message},error.status||400);
      }
    }

    if (action === "source.create") {
      const businessId = String(body.business_id || "");
      const label = String(body.label || "Zernio");
      const apiKey = String(body.api_key || "").trim();
      const externalProfileId = String(body.external_profile_id || "").trim();
      if (!businessId || !apiKey || !externalProfileId) return json({ ok:false, error:"Negocio, API key y perfil Zernio son obligatorios." },400);

      const { data: business, error: businessError } = await admin
        .from("link_world_businesses").select("id,name,slug").eq("id",businessId).single();
      if (businessError || !business) return json({ok:false,error:"Negocio no encontrado."},404);

      const profilesPayload = await zernioGet(apiKey, "/v1/profiles");
      const profiles = rows(profilesPayload, ["profiles"]);
      const externalProfile = profiles.find((p:any)=>String(p._id||p.id||"")===externalProfileId);
      if (!externalProfile) return json({ok:false,error:"El perfil Zernio seleccionado no pertenece a esta API key."},400);

      let { data: profile } = await admin.from("link_rrss_profiles")
        .select("id").eq("business_id",businessId).eq("slug","main").maybeSingle();
      if (!profile) {
        const inserted = await admin.from("link_rrss_profiles").insert({
          business_id:businessId,name:business.name,slug:"main",status:"configuring",
          metadata:{source:"link-rrss"}
        }).select("id").single();
        if (inserted.error) throw inserted.error;
        profile=inserted.data;
      }

      const secretResult = await admin.rpc("link_rrss_store_secret", {
        p_secret:apiKey,
        p_name:`link-rrss-zernio-${business.slug}-${crypto.randomUUID()}`,
        p_description:`Zernio credential for ${business.name}`
      });
      if (secretResult.error || !secretResult.data) throw secretResult.error || new Error("No se pudo guardar la credencial.");

      const sourceInsert = await admin.from("link_rrss_sources").insert({
        profile_id:profile.id,provider:"zernio",label,
        vault_secret_id:secretResult.data,status:"configuring",
        external_profile_id:externalProfileId,
        metadata:{
          key_preview:apiKey.slice(0,4)+"…"+apiKey.slice(-4),
          external_profile_name:externalProfile.name || externalProfile.label || "Perfil Zernio"
        }
      }).select("id").single();
      if (sourceInsert.error) throw sourceInsert.error;

      await syncAccounts(admin,sourceInsert.data.id,apiKey,externalProfileId);
      const summary = await fullSync(admin,businessId,"source_create");
      return json({ok:true,source_id:sourceInsert.data.id,account_count:summary.accounts||0,summary});
    }

    if (action === "source.sync") {
      const sourceId=String(body.source_id||"");
      const {source,profile,businessId,apiKey}=await sourceContext(admin,sourceId);
      const data=await syncAccounts(admin,sourceId,apiKey,source.external_profile_id);
      await cacheSnapshot(admin,{businessId,sourceId,module:"accounts",payload:data,status:data.accounts.length?"ok":"empty",ttlMinutes:5});
      await admin.from("link_rrss_workspace_state").upsert({
        business_id:businessId,active_profile_id:profile.id,updated_at:new Date().toISOString()
      },{onConflict:"business_id"});
      return json({ok:true,...data});
    }

    if (action === "sync.business") {
      const businessId=String(body.business_id||"");
      if(!businessId) return json({ok:false,error:"business_id obligatorio."},400);
      const summary=await fullSync(admin,businessId,String(body.trigger||"manual"));
      return json({ok:true,summary});
    }

    if (action === "history.backfill") {
      const sourceId=String(body.source_id||"");
      const localAccountId=String(body.account_id||"");
      const months=Number(body.months||18);
      if(!sourceId || !localAccountId) return json({ok:false,error:"source_id y account_id son obligatorios."},400);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      const {data:account,error:accountError}=await admin.from("link_rrss_accounts").select("*").eq("id",localAccountId).eq("source_id",sourceId).single();
      if(accountError || !account) return json({ok:false,error:"Cuenta RRSS no encontrada."},404);
      const result=await backfillAccountHistory(admin,apiKey,account,months);
      return json({ok:true,result});
    }

    if (action === "workspace.touch") {
      const businessId=String(body.business_id||"");
      if(!businessId) return json({ok:false,error:"business_id obligatorio."},400);
      const patch:any={
        business_id:businessId,
        last_opened_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      };
      if(body.last_section) patch.last_section=String(body.last_section);
      if(body.active_account_id!==undefined) patch.active_account_id=body.active_account_id||null;
      if(body.active_profile_id!==undefined) patch.active_profile_id=body.active_profile_id||null;
      if(body.ui_state!==undefined) patch.ui_state=body.ui_state||{};
      const {error}=await admin.from("link_rrss_workspace_state").upsert(patch,{onConflict:"business_id"});
      if(error) throw error;
      return json({ok:true});
    }

    if (action === "connect.url") {
      const sourceId=String(body.source_id||"");
      const platform=String(body.platform||"").toLowerCase();
      const redirectUrl=String(body.redirect_url||"");
      if (!CONNECT_PLATFORMS.has(platform)) return json({ok:false,error:"Plataforma no soportada por el conector estándar de Zernio."},400);
      if (!redirectUrl.startsWith("http://") && !redirectUrl.startsWith("https://")) return json({ok:false,error:"redirect_url inválida."},400);
      const {source,apiKey}=await readSourceSecret(admin,sourceId);
      if (!source.external_profile_id) return json({ok:false,error:"Esta fuente no tiene un perfil Zernio asociado."},409);
      const query:any={profileId:source.external_profile_id,redirect_url:redirectUrl};
      if(platform==="instagram" && body.login_method) query.loginMethod=String(body.login_method);
      if(platform==="whatsapp"){ query.signup="hosted";query.brandName="LINK RRSS";query.language="es"; }
      const data=await zernioGet(apiKey,`/v1/connect/${platform}`,query);
      return json({ok:true,data});
    }

    if (action === "media.upload") {
      const sourceId=String(body.source_id||"");
      const filename=String(body.filename||"").trim();
      const contentType=String(body.content_type||"").trim().toLowerCase();
      const encoded=String(body.base64_data||"").trim();
      if(!sourceId || !filename || !contentType || !encoded) return json({ok:false,error:"source_id, filename, content_type y base64_data son obligatorios."},400);
      if(!["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime"].includes(contentType)) {
        return json({ok:false,error:"Tipo de archivo no soportado para publicación."},400);
      }
      const cleanBase64=encoded.includes(",")?encoded.slice(encoded.indexOf(",")+1):encoded;
      let bytes:Uint8Array;
      try {
        const binary=atob(cleanBase64);
        bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      } catch {
        return json({ok:false,error:"El archivo no pudo decodificarse."},400);
      }
      if(!bytes.byteLength) return json({ok:false,error:"El archivo está vacío."},400);
      if(bytes.byteLength>25*1024*1024) return json({ok:false,error:"LINK RRSS limita esta subida directa a 25 MB."},413);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      const presigned=await zernioPost(apiKey,"/v1/media/presign",{
        filename,
        contentType,
        size:bytes.byteLength
      });
      const uploadUrl=String(presigned?.uploadUrl||"");
      const publicUrl=String(presigned?.publicUrl||"");
      if(!uploadUrl || !publicUrl) return json({ok:false,error:"Zernio no devolvió URLs de subida válidas."},502);
      const uploaded=await fetch(uploadUrl,{
        method:"PUT",
        headers:{"Content-Type":contentType},
        body:bytes
      });
      if(!uploaded.ok) {
        const detail=await uploaded.text().catch(()=>"");
        return json({ok:false,error:"No se pudo subir el archivo al almacenamiento de Zernio.",detail},502);
      }
      return json({ok:true,public_url:publicUrl,key:presigned?.key||null,expires_in:presigned?.expiresIn||null});
    }

    if (action === "post.publish") {
      const sourceId=String(body.source_id||"");
      const localAccountId=String(body.account_id||"");
      const content=String(body.content||"").trim();
      const mediaUrl=String(body.media_url||"").trim();
      const mediaType=String(body.media_type||"image").trim().toLowerCase();
      if(!sourceId || !localAccountId || !mediaUrl) return json({ok:false,error:"source_id, account_id y media_url son obligatorios."},400);
      if(!mediaUrl.startsWith("https://")) return json({ok:false,error:"media_url debe ser HTTPS."},400);
      if(!["image","video","gif","document"].includes(mediaType)) return json({ok:false,error:"media_type no soportado."},400);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      const {data:account,error:accountError}=await admin.from("link_rrss_accounts")
        .select("id,source_id,external_account_id,platform,username,status,can_post")
        .eq("id",localAccountId).eq("source_id",sourceId).single();
      if(accountError || !account) return json({ok:false,error:"Cuenta RRSS no encontrada dentro de esta fuente."},404);
      if(account.status!=="connected" || account.can_post===false) return json({ok:false,error:"La cuenta no está habilitada para publicar."},409);
      if(String(account.platform||"").toLowerCase()==="instagram" && !mediaUrl) return json({ok:false,error:"Instagram requiere media."},400);
      const idempotencyKey=String(body.idempotency_key||crypto.randomUUID());
      const payload:any={
        content,
        mediaItems:[{type:mediaType,url:mediaUrl}],
        platforms:[{platform:String(account.platform||"").toLowerCase(),accountId:String(account.external_account_id)}],
        publishNow:true
      };
      const data=await zernioPost(apiKey,"/v1/posts",payload,{"Idempotency-Key":idempotencyKey});
      const created=data?.post||data;
      if(created) {
        await persistPosts(admin,account,[created]);
        const externalId=String(created?._id||created?.id||created?.platformPostId||"");
        const target=(created?.platforms||[]).find((p:any)=>String(p?.platform||"").toLowerCase()===String(account.platform||"").toLowerCase()) || created?.platforms?.[0] || {};
        if(externalId) await cacheActivity(admin,{
          accountId:account.id,
          activityType:"publication",
          externalId,
          occurredAt:created?.publishedAt||created?.createdAt||new Date().toISOString(),
          payload:{
            post_id:externalId,
            text:created?.content||content,
            media_type:mediaType,
            thumbnail:created?.thumbnailUrl||created?.mediaItems?.[0]?.thumbnail||mediaUrl,
            url:target?.platformPostUrl||created?.platformPostUrl||null,
            metrics:created?.analytics||created?.metrics||{}
          }
        });
        await refreshAccountMemory(admin,account.id);
      }
      return json({
        ok:true,
        data,
        post_id:created?._id||created?.id||null,
        status:created?.status||null,
        platform_post_url:(created?.platforms||[]).find((p:any)=>String(p?.platform||"").toLowerCase()===String(account.platform||"").toLowerCase())?.platformPostUrl||created?.platformPostUrl||null
      });
    }

    if (action === "inbox.send") {
      const sourceId=String(body.source_id||"");
      const conversationId=String(body.conversation_id||"");
      const accountId=String(body.account_id||"");
      const message=String(body.message||"").trim();
      if(!sourceId || !conversationId || !accountId || !message) return json({ok:false,error:"source_id, conversation_id, account_id y message son obligatorios."},400);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      const idempotencyKey=String(body.idempotency_key||crypto.randomUUID());
      const data=await zernioPost(apiKey,`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,{accountId,message},{"Idempotency-Key":idempotencyKey});
      return json({ok:true,data});
    }

    if (action === "inbox.read") {
      const sourceId=String(body.source_id||"");
      const conversationId=String(body.conversation_id||"");
      const accountId=String(body.account_id||"");
      if(!sourceId || !conversationId || !accountId) return json({ok:false,error:"source_id, conversation_id y account_id son obligatorios."},400);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      const data=await zernioPost(apiKey,`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/read`,{accountId});
      return json({ok:true,data});
    }

    if (action === "zernio.get") {
      const sourceId=String(body.source_id||"");
      const path=String(body.path||"");
      if(!READ_PREFIXES.some(prefix=>path.startsWith(prefix))) return json({ok:false,error:"Endpoint no habilitado en LINK RRSS."},403);
      const {apiKey}=await readSourceSecret(admin,sourceId);
      return json({ok:true,data:await zernioGet(apiKey,path,body.query||{})});
    }

    return json({ok:false,error:"Acción desconocida."},400);
  } catch(error:any) {
    return json({ok:false,error:error?.message||"Error inesperado.",detail:error?.payload||null},error?.status||500);
  }
});