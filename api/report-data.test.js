import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialReportData } from './report-data.js';

const fixture = () => ({
  business: {
    id: '31333b84-79fa-4c52-b974-977145ec9e9a', global_id: 'LNK-BIZ-8940CF9AD521445D',
    slug: 'caracol', name: 'CARACOL',
    owned_facts: {
      sold_product: { commitments: [{ code: 'CAR-E1-C03', title: '8 reels mensuales', status: 'in_progress' }] },
      content_rules: { real_material_required: true, ai_generated_visuals_for_caracol: false }
    }
  },
  status: { rrss_status: 'active' },
  accounts: [{ id: 'account-1', status: 'connected', platform: 'instagram', username: 'caracol_barrestaurant', can_post: true }],
  snapshots: [
    { module: 'content', account_id: 'account-1', status: 'ok', fetched_at: '2026-09-28T11:36:00Z',
      stale_after: '2026-09-28T11:46:00Z',
      payload: { posts: [
        { id: 'p1', createdTime: '2026-09-27T17:32:46Z', mediaType: 'VIDEO', likeCount: 12, commentCount: 2 },
        { id: 'p0', createdTime: '2026-08-31T17:32:46Z', mediaType: 'IMAGE', likeCount: 3 }
      ] } },
    { module: 'analytics', account_id: 'account-1', status: 'ok', fetched_at: '2026-09-28T11:36:00Z',
      stale_after: '2026-09-28T11:46:00Z', payload: { posts: [], pagination: { page: 1, pages: 2, total: 79 } } },
    { module: 'inbox', account_id: 'account-1', status: 'ok', fetched_at: '2026-09-28T11:36:00Z',
      stale_after: '2026-09-28T11:39:00Z',
      payload: { data: [{ unreadCount: 5, lastMessage: 'private message', participantName: 'Private Person' }],
        pagination: { hasMore: true } } }
  ],
  from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z',
  now: Date.parse('2026-09-28T12:45:00Z')
});

test('report preserves evidence limits and excludes private messages', () => {
  const report = buildSocialReportData(fixture());
  const channel = report.reports[0];
  assert.equal(report.commitments[0].title, '8 reels mensuales');
  assert.equal(report.content_rules.ai_generated_visuals_allowed, false);
  assert.equal(channel.sources.content.stale, true);
  assert.equal(channel.observed_posts_in_page.length, 1);
  assert.equal(channel.page_coverage.analytics_reported_total_all_time, 79);
  assert.equal(channel.page_coverage.analytics_has_more, true);
  assert.equal(channel.unread_in_loaded_inbox_page, 5);
  assert.equal(JSON.stringify(report).includes('private message'), false);
  assert.equal(JSON.stringify(report).includes('Private Person'), false);
  assert.equal(JSON.stringify(report).includes('delivered_reels'), false);
});

test('missing inbox stays unknown and invalid range is rejected', () => {
  const input = fixture();
  input.snapshots = input.snapshots.filter(s => s.module !== 'inbox');
  assert.equal(buildSocialReportData(input).reports[0].unread_in_loaded_inbox_page, null);
  input.to = input.from;
  assert.throws(() => buildSocialReportData(input), /período/);
});
