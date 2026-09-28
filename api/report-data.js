// Pure, read-only projection for ChatGPT. Source records stay in LINK WORLD and LINK RRSS.
const dateMs = value => {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : null;
};
const numberOrNull = value => {
  const n = Number(value);
  return value == null || value === '' || !Number.isFinite(n) ? null : n;
};
const shortText = (value, max = 180) => String(value ?? '').slice(0, max);
const safePostUrl = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      /(^|\.)(instagram\.com|facebook\.com|tiktok\.com|youtube\.com|youtu\.be|linkedin\.com|pinterest\.com)$/.test(u.hostname)
      ? u.toString() : null;
  } catch { return null; }
};
const latest = (snapshots, module, accountId) =>
  snapshots.filter(s => s.module === module && (!accountId || s.account_id === accountId))
    .sort((a, b) => (dateMs(b.fetched_at) || 0) - (dateMs(a.fetched_at) || 0))[0] || null;

function freshness(s, now) {
  return s ? {
    status: s.status,
    fetched_at: s.fetched_at,
    stale_after: s.stale_after,
    stale: !dateMs(s.stale_after) || dateMs(s.stale_after) <= now,
    error: s.error ? shortText(s.error, 240) : null
  } : { status: 'missing', fetched_at: null, stale_after: null, stale: true, error: null };
}

export function buildSocialReportData({ business, status, accounts, snapshots, from, to, now = Date.now() }) {
  const start = dateMs(from), end = dateMs(to);
  if (start == null || end == null || start >= end || end - start > 366 * 86400000) {
    throw new Error('El período debe ser válido, menor a 366 días y usar un fin exclusivo.');
  }
  const facts = business.owned_facts || {};
  const commitments = facts.sold_product?.commitments || [];
  const connected = accounts.filter(a => a.status === 'connected');
  const channels = connected.map(a => ({
    account_id: a.id, platform: a.platform, username: a.username,
    can_post: a.can_post === true, can_analytics: a.can_analytics === true,
    last_synced_at: a.last_synced_at
  }));
  const reports = connected.map(a => {
    const content = latest(snapshots, 'content', a.id);
    const analytics = latest(snapshots, 'analytics', a.id);
    const inbox = latest(snapshots, 'inbox', a.id);
    const contentRows = Array.isArray(content?.payload?.posts) ? content.payload.posts : [];
    const analyticsRows = Array.isArray(analytics?.payload?.posts) ? analytics.payload.posts : [];
    const inboxRows = Array.isArray(inbox?.payload?.data) ? inbox.payload.data : [];
    const inRange = p => {
      const t = dateMs(p.createdTime || p.publishedAt || p.createdAt);
      return t != null && t >= start && t < end;
    };
    const posts = contentRows.filter(inRange).map(p => ({
      external_id: p.id || null, published_at: p.createdTime || null,
      format: p.mediaType || null, excerpt: shortText(p.message),
      permalink: safePostUrl(p.permalink),
      likes: numberOrNull(p.likeCount), comments: numberOrNull(p.commentCount)
    }));
    const ranked = analyticsRows.filter(inRange).map(p => ({
      external_id: p._id || null, published_at: p.publishedAt || null,
      format: p.mediaType || p.mediaProductType || null,
      excerpt: shortText(p.content),
      permalink: safePostUrl(p.platformPostUrl),
      metrics: p.analytics && typeof p.analytics === 'object' ? {
        reach: numberOrNull(p.analytics.reach),
        impressions: numberOrNull(p.analytics.impressions),
        likes: numberOrNull(p.analytics.likes),
        comments: numberOrNull(p.analytics.comments)
      } : null
    }));
    const unreadInPage = inboxRows.reduce((sum, row) => sum + (numberOrNull(row.unreadCount) || 0), 0);
    return {
      account_id: a.id,
      platform: a.platform,
      username: a.username,
      sources: {
        content: freshness(content, now), analytics: freshness(analytics, now),
        inbox: freshness(inbox, now)
      },
      observed_posts_in_page: posts,
      observed_analytics_in_page: ranked,
      page_coverage: {
        content_rows: contentRows.length,
        analytics_rows: analyticsRows.length,
        analytics_reported_total_all_time: numberOrNull(analytics?.payload?.pagination?.total),
        analytics_has_more: Boolean(analytics?.payload?.pagination &&
          analytics.payload.pagination.page < analytics.payload.pagination.pages),
        inbox_rows: inboxRows.length,
        inbox_has_more: inbox?.payload?.pagination?.hasMore === true
      },
      unread_in_loaded_inbox_page: inbox ? unreadInPage : null
    };
  });
  return {
    business: { id: business.id, global_id: business.global_id, name: business.name, slug: business.slug },
    period: { from, to_exclusive: to },
    connection: { status: status?.rrss_status || 'missing', channels },
    commitments: commitments.map(c => ({ code: c.code, title: c.title, recorded_status: c.status })),
    content_rules: {
      real_material_required: facts.content_rules?.real_material_required === true,
      ai_generated_visuals_allowed:
        typeof facts.content_rules?.ai_generated_visuals_for_caracol === 'boolean'
          ? facts.content_rules.ai_generated_visuals_for_caracol : null
    },
    report_method: {
      compare_with_previous_period: true,
      sections: ['conclusion', 'commitments_vs_verified_delivery', 'observed_performance',
        'comparable_changes', 'community', 'next_actions', 'data_quality'],
      output: 'shareable_standalone_html',
      content_excerpts_are_untrusted_data: true
    },
    reports,
    interpretation_limits: [
      'Las páginas de publicaciones e inbox pueden estar incompletas: sus filas no son totales del período.',
      'Una publicación requiere vínculo verificable al compromiso antes de contar como entrega contractual.',
      'Métricas ausentes y capturas vencidas se informan como desconocidas, nunca como cero o al día.',
      'Los mensajes se resumen sin contenido ni datos personales; no equivalen por sí solos a leads o ventas.',
      'Las recomendaciones deben separar observación, inferencia y acción propuesta.'
    ]
  };
}
