import test from 'node:test';
import assert from 'node:assert/strict';
import mcp from './mcp.js';
import resource from './oauth-resource.js';

function response() {
  const headers = {};
  return {
    headers, statusCode: 200, body: '',
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(v = '') { this.body = v; return this; }
  };
}

test('MCP never serves data to an anonymous caller', async () => {
  const res = response();
  await mcp({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['www-authenticate'], /oauth-protected-resource/);
  assert.equal(res.body.includes('businesses'), false);
});

test('OAuth protected resource metadata identifies the LINK issuer', () => {
  const res = response();
  resource({ method: 'GET' }, res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.resource, 'https://linkrrss.vercel.app/mcp');
  assert.deepEqual(body.authorization_servers, ['https://zgbnjlrxzvzpigmwidsp.supabase.co/auth/v1']);
});
