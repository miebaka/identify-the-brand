// Admin authentication: env-based credential + HMAC-signed bearer token.
// No password is ever hard-coded; timing-safe comparison throughout.
import crypto from 'node:crypto';
import config from './config.js';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// Sign with the configured secret. If no secret is set we return null (never a
// hard-coded fallback): a published constant would let anyone forge a valid
// token and skip /login entirely, regardless of NODE_ENV.
function sign(payload) {
  const secret = config.admin.tokenSecret;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

// Constant-time string compare that also resists length leakage.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Compare against self to keep timing uniform, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyCredentials(user, password) {
  const okUser = safeEqual(user || '', config.admin.user);
  const okPass = config.admin.password
    ? safeEqual(password || '', config.admin.password)
    : false;
  return okUser && okPass;
}

export function issueToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `admin.${exp}`;
  const mac = sign(body);
  return mac ? `${body}.${mac}` : null; // null when no secret is configured
}

export function verifyToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [subject, expStr, mac] = parts;
  const body = `${subject}.${expStr}`;
  const expected = sign(body);
  if (!expected) return false; // no secret configured → no valid token exists
  if (!safeEqual(mac, expected)) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return subject === 'admin';
}

// Express middleware guarding admin API routes.
export function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}
