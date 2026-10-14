// Network boundary helpers shared by the CLI server and outbound clients.
//
// Two concerns live here:
// 1. Loopback detection for Host/Origin validation on the local HTTP service
//    (a remote web page must not be able to drive the local service).
// 2. Outbound endpoint validation so a bearer token or API key can never be
//    sent to an unexpected plaintext origin.

export function normalizeHostname(h) {
  if (!h) return '';
  let x = String(h).trim().toLowerCase();
  if (x.startsWith('[') && x.endsWith(']')) x = x.slice(1, -1);
  return x;
}

export function isLoopbackHostname(h) {
  const x = normalizeHostname(h);
  if (!x) return false;
  if (x === 'localhost' || x === '::1') return true;
  if (x.startsWith('::ffff:127.')) return true;
  return /^127(\.\d{1,3}){3}$/.test(x);
}

// Extract the hostname from a Host header value ("host", "host:port",
// "[::1]:port"). Never includes the port.
export function hostnameOfHostHeader(hh) {
  if (!hh) return '';
  const s = String(hh).trim();
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return normalizeHostname(bracketed[1]);
  const parts = s.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return normalizeHostname(parts[0]);
  return normalizeHostname(s);
}

// Hostname of an Origin header, or null when the value is not a valid URL
// (this includes the literal "null" sent by sandboxed pages).
export function originHostname(origin) {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return null;
  }
}

// Validate and normalize an outbound endpoint URL.
//
// Rules:
// - loopback http(s) is fine (local node, local provider test rig);
// - non-loopback requires https;
// - when remoteOptInEnv is set, a non-loopback host additionally requires that
//   environment variable to be exactly "1", making the credential destination
//   an explicit operator decision.
export function validateEndpointUrl(raw, { name = 'endpoint', remoteOptInEnv = '' } = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error(`${name} is not a valid absolute URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${name} must be an http(s) URL`);
  }
  if (!isLoopbackHostname(u.hostname)) {
    if (u.protocol !== 'https:') {
      throw new Error(`${name} must use https for non-loopback hosts`);
    }
    if (remoteOptInEnv && process.env[remoteOptInEnv] !== '1') {
      throw new Error(`${name} targets a non-loopback host; set ${remoteOptInEnv}=1 to confirm sending credentials to it`);
    }
  }
  return u.toString().replace(/\/+$/, '');
}

// Parse a byte-size environment value for request-body caps.
// Accepts only a positive safe integer; anything else (empty, "abc", 0,
// negatives, floats, unsafe integers) falls back to the documented default
// with a warning. The size cap is never disabled silently.
export function parseMaxBody(raw, defaultBytes, warn = console.error) {
  if (raw === undefined || raw === '') return defaultBytes;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    warn(`DKG_RAG_MAX_BODY="${raw}" is not a positive integer; using default ${defaultBytes} bytes`);
    return defaultBytes;
  }
  return n;
}
