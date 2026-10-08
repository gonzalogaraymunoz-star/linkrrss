// LINKRRSS Cloudflare runtime. Existing Zernio/Supabase flow remains unchanged.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'linkrrss', runtime: 'cloudflare-worker' }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
