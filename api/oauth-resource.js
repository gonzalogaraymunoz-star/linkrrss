import { SUPABASE_URL } from '../src/connection.js';

export const mcpOrigin = () =>
  (process.env.LINK_RRSS_MCP_ORIGIN || 'https://linkrrss.vercel.app').replace(/\/$/, '');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.end(JSON.stringify({
    resource: `${mcpOrigin()}/mcp`,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    scopes_supported: ['email']
  }));
}
