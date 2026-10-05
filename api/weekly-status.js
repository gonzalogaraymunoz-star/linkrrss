import { createClient } from '@supabase/supabase-js';

const EXPECTED = [
  { key: 'caracol', name: 'Caracol', aliases: ['caracol'] },
  { key: 'franchuteria', name: 'Franchutería', aliases: ['franchuteria'] },
  { key: 'cafe-roots', name: 'Café Roots', aliases: ['cafe roots', 'roots', 'caferoots'] },
];

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesProfile(profile, business) {
  const haystack = normalize(`${profile?.name || ''} ${profile?.slug || ''}`);
  return business.aliases.some((alias) => haystack.includes(normalize(alias)));
}

function hoursSince(value) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 36e5) : null;
}

function metricPresent(metrics) {
  return metrics && typeof metrics === 'object' && Object.keys(metrics).length > 0;
}

function looksActiveAutomation(row) {
  const status = normalize(row?.status || row?.apparatus_status || row?.state || '');
  if (['connected', 'active', 'ready', 'enabled', 'executed'].some((x) => status.includes(x))) return true;
  const counters = ['executed_count', 'actions_executed', 'total_actions', 'success_count', 'uses'];
  return counters.some((key) => Number(row?.[key] || 0) > 0);
}

async function readRows(supabase, table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}

function buildBusinessReport(business, datasets) {
  const profiles = datasets.profiles.filter((p) => matchesProfile(p, business));

  if (!profiles.length) {
    return {
      business: business.name,
      key: business.key,
      stage: 'pending',
      ready: [],
      in_progress: [],
      pending: [
        'Crear perfil de negocio en LINKRRSS',
        'Conectar y autorizar perfiles sociales',
        'Habilitar publicación y analítica',
        'Configurar automatización de respuestas',
        'Activar métricas y alertas',
      ],
      blockers: ['Negocio aún no registrado en LINKRRSS'],
      metrics: { profiles: 0, accounts: 0, connected_accounts: 0, posts_7d: 0, posts_with_metrics_7d: 0 },
      decisions: ['Confirmar onboarding y perfiles sociales que se conectarán'],
      next_milestones: ['Alta de negocio → autorización de cuentas → primera sincronización'],
    };
  }

  const profileIds = new Set(profiles.map((p) => p.id));
  const sources = datasets.sources.filter((s) => profileIds.has(s.profile_id));
  const sourceIds = new Set(sources.map((s) => s.id));
  const accounts = datasets.accounts.filter((a) => sourceIds.has(a.source_id));
  const accountIds = new Set(accounts.map((a) => a.id));
  const businessIds = new Set(profiles.map((p) => p.business_id).filter(Boolean));

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = datasets.posts.filter((p) =>
    businessIds.has(p.business_id) || accountIds.has(p.account_id)
  );
  const posts7d = posts.filter((p) => {
    const when = new Date(p.published_at || p.updated_at || 0).getTime();
    return Number.isFinite(when) && when >= weekAgo;
  });
  const postsWithMetrics = posts7d.filter((p) => metricPresent(p.metrics));
  const automationRows = datasets.automation.filter((r) => businessIds.has(r.business_id));
  const connectedAccounts = accounts.filter((a) => normalize(a.status).includes('connected'));
  const canPost = accounts.filter((a) => a.can_post === true);
  const canAnalytics = accounts.filter((a) => a.can_analytics === true);
  const activeAutomation = automationRows.some(looksActiveAutomation);

  const ready = [];
  const inProgress = [];
  const pending = [];
  const blockers = [];
  const decisions = [];
  const nextMilestones = [];
  const alerts = [];

  if (profiles.some((p) => normalize(p.status).includes('active'))) ready.push('Perfil LINKRRSS activo');
  else inProgress.push('Perfil LINKRRSS creado, pero no activo');

  if (connectedAccounts.length === accounts.length && accounts.length > 0) ready.push('Perfiles sociales conectados y autorizados');
  else if (accounts.length > 0) inProgress.push(`Autorizaciones parciales: ${connectedAccounts.length}/${accounts.length} cuentas conectadas`);
  else pending.push('Conectar perfiles sociales');

  if (canPost.length > 0) ready.push('Permiso de publicación disponible');
  else pending.push('Habilitar permiso de publicación');

  if (posts7d.length > 0) ready.push(`${posts7d.length} publicación(es) detectada(s) en los últimos 7 días`);
  else inProgress.push('Sin publicaciones detectadas en los últimos 7 días');

  if (activeAutomation) ready.push('Automatización de respuestas con evidencia de actividad');
  else inProgress.push('Automatización de respuestas sin evidencia suficiente de ejecución');

  if (canAnalytics.length > 0 && postsWithMetrics.length > 0) ready.push('Métricas activas y recibiendo datos');
  else if (canAnalytics.length > 0) inProgress.push('Analítica habilitada, pendiente evidencia de métricas recientes');
  else pending.push('Habilitar analítica');

  for (const account of accounts) {
    const age = hoursSince(account.last_synced_at);
    if (age !== null && age > 24) alerts.push(`Sincronización atrasada: @${account.username || account.display_name || 'cuenta'} · ${age} h`);
    if (account.status !== 'connected') alerts.push(`Cuenta no conectada: @${account.username || account.display_name || 'cuenta'}`);
    if (account.can_post === false) alerts.push(`Publicación no autorizada: @${account.username || account.display_name || 'cuenta'}`);
    if (account.can_analytics === false) alerts.push(`Analítica no autorizada: @${account.username || account.display_name || 'cuenta'}`);
  }

  for (const source of sources) {
    if (normalize(source.status) && !normalize(source.status).includes('connected') && !normalize(source.status).includes('active')) {
      alerts.push(`Fuente ${source.provider || source.label || 'RRSS'} en estado ${source.status}`);
    }
  }

  if (!accounts.length) blockers.push('Perfil sin cuenta social enlazada');
  if (!canPost.length) blockers.push('No hay una cuenta autorizada para publicar');
  if (!canAnalytics.length) blockers.push('No hay una cuenta autorizada para analítica');
  if (!activeAutomation) decisions.push('Definir si la automatización de respuestas pasa de asistencia a ejecución activa');
  if (!posts7d.length) decisions.push('Definir próxima publicación o calendario operativo');
  if (alerts.length) decisions.push('Resolver alertas de conexión/sincronización antes del siguiente corte');

  if (!blockers.length && !pending.length && alerts.length === 0) {
    nextMilestones.push('Mantener operación semanal y comparar métricas contra el corte anterior');
  } else {
    nextMilestones.push('Cerrar autorizaciones/capacidades faltantes');
    nextMilestones.push('Validar una publicación y una respuesta automatizada de punta a punta');
    nextMilestones.push('Confirmar métricas y alertas tras la siguiente sincronización');
  }

  const stage = pending.length || blockers.length ? 'in_progress' : 'ready';

  return {
    business: business.name,
    key: business.key,
    stage,
    ready,
    in_progress: inProgress,
    pending,
    blockers,
    alerts,
    metrics: {
      profiles: profiles.length,
      sources: sources.length,
      accounts: accounts.length,
      connected_accounts: connectedAccounts.length,
      post_enabled_accounts: canPost.length,
      analytics_enabled_accounts: canAnalytics.length,
      posts_7d: posts7d.length,
      posts_with_metrics_7d: postsWithMetrics.length,
      automation_rows: automationRows.length,
    },
    decisions,
    next_milestones: nextMilestones,
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, error: 'GET required' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.authorization !== `Bearer ${cronSecret}`) {
    return response.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return response.status(500).json({ ok: false, error: 'Missing Supabase environment variables' });
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [profilesR, sourcesR, accountsR, postsR, automationR] = await Promise.all([
    readRows(supabase, 'link_rrss_public_profiles_v'),
    readRows(supabase, 'link_rrss_public_sources_v'),
    readRows(supabase, 'link_rrss_public_accounts_v'),
    readRows(supabase, 'link_rrss_public_posts_v'),
    readRows(supabase, 'link_rrss_resolution_apparatus_stats_v'),
  ]);

  const datasets = {
    profiles: profilesR.rows,
    sources: sourcesR.rows,
    accounts: accountsR.rows,
    posts: postsR.rows,
    automation: automationR.rows,
  };

  const businesses = EXPECTED.map((business) => buildBusinessReport(business, datasets));
  const report = {
    ok: true,
    report_type: 'linkrrss_weekly_deployment_status',
    generated_at: new Date().toISOString(),
    source: 'vercel-cron+linkrrss-supabase-public-views',
    coverage: ['profiles_authorizations', 'publications', 'response_automation', 'metrics_alerts', 'blockers'],
    data_warnings: [
      profilesR.error && `profiles: ${profilesR.error}`,
      sourcesR.error && `sources: ${sourcesR.error}`,
      accountsR.error && `accounts: ${accountsR.error}`,
      postsR.error && `posts: ${postsR.error}`,
      automationR.error && `automation: ${automationR.error}`,
    ].filter(Boolean),
    businesses,
    summary: {
      ready: businesses.filter((b) => b.stage === 'ready').map((b) => b.business),
      in_progress: businesses.filter((b) => b.stage === 'in_progress').map((b) => b.business),
      pending: businesses.filter((b) => b.stage === 'pending').map((b) => b.business),
      blockers: businesses.flatMap((b) => b.blockers.map((x) => `${b.business}: ${x}`)),
      decisions_needed: businesses.flatMap((b) => b.decisions.map((x) => `${b.business}: ${x}`)),
      next_milestones: businesses.flatMap((b) => b.next_milestones.map((x) => `${b.business}: ${x}`)),
    },
  };

  console.log('LINKRRSS_WEEKLY_STATUS ' + JSON.stringify(report));
  return response.status(200).json(report);
}
