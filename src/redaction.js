// Secret redaction gate — ported from openclaw-memory-curator/src/redaction.js.
// Scans literal strings for obvious secrets and replaces spans with
// [REDACTED:<kind>]. Returns { text, count }.

const HEX64 = /\b0x[a-fA-F0-9]{64}\b/g;
const SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const TOKEN_PREFIX = /\b(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9\-]{12,})\b/g;
const KEY_LINE_FLAG = /(private[_ ]?key|secret|token|mnemonic|seed)\s*[:=]\s*([^\s]+)/gi;

export function redact(text) {
  if (typeof text !== 'string' || text.length === 0) return { text, count: 0 };
  let count = 0;
  let out = text;
  const replace = (re, kind) => {
    out = out.replace(re, () => { count++; return `[REDACTED:${kind}]`; });
  };
  replace(HEX64, 'hex-private-key');
  replace(TOKEN_PREFIX, 'api-token');
  replace(KEY_LINE_FLAG, 'secret-line');
  // Solana heuristic: only after other passes, and only if high-entropy (mixed case+digits)
  out = out.replace(SOLANA, (m) => {
    if (/[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m) && m.length >= 32) {
      count++;
      return `[REDACTED:solana-key]`;
    }
    return m;
  });
  return { text: out, count };
}

export function redactQuads(quads) {
  let total = 0;
  const out = quads.map(q => {
    const r = redact(q.object);
    total += r.count;
    return { subject: q.subject, predicate: q.predicate, object: r.text };
  });
  return { quads: out, redactedCount: total };
}
