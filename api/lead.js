const SITE_SLUG = 'waermepumpe-rechner-v2';
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function getHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
}

function getClientIp(req) {
  const fwd = getHeader(req, 'x-forwarded-for');
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

function sanitizeString(value, maxLen = 800) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); }
    catch { throw new Error('INVALID_JSON'); }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return res.status(500).json({ ok: false, error: 'server_not_configured', message: `Missing env: ${missing.join(', ')}` });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const name = sanitizeString(body?.name, 120);
  const emailRaw = sanitizeString(body?.email, 255);
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phone = sanitizeString(body?.phone, 40);
  const intent = sanitizeString(body?.goal || body?.intent, 500);
  const source_url = sanitizeString(body?.source_url || body?.url, 2048);

  if (!name || !email || !intent) {
    return res.status(400).json({ ok: false, error: 'validation_error', message: 'name, email and goal are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'validation_error', message: 'email invalid' });
  }

  const lead = {
    site: SITE_SLUG,
    name,
    email,
    phone,
    intent,
    source_url,
    metadata: {
      calculator: body?.calculator || null,
      ip: getClientIp(req),
      user_agent: sanitizeString(getHeader(req, 'user-agent'), 500),
    },
  };

  try {
    const endpoint = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/leads`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(lead),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Lead insert failed', response.status, text);
      return res.status(502).json({ ok: false, error: 'storage_error', message: 'Lead could not be stored' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('lead handler internal error', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
