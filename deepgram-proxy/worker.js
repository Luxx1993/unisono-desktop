// Minimal CORS proxy for Deepgram's pre-recorded API, deployable as a Cloudflare Worker.
// Deepgram rejects browser requests (no CORS headers), so Scribe Studio sends them here instead.
// The API key stays in the browser and is forwarded unchanged in the Authorization header;
// this worker stores nothing.
//
// Optional: set the ALLOWED_ORIGIN variable (e.g. "https://luxx1993.github.io") to restrict
// who may use the proxy. Without it, any origin is allowed.

const UPSTREAM = 'https://api.deepgram.com';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    if (allowed !== '*' && origin !== allowed) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/listen') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream',
      },
      body: request.body,
    });

    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
