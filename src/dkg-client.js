// Minimal DKG HTTP client — zero deps, built-in fetch.
// Auth token read from ~/.dkg/auth.token (line 2, skip # comment lines).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_BASE = 'http://127.0.0.1:9200';

function loadToken(tokenPath) {
  const p = tokenPath || join(homedir(), '.dkg', 'auth.token');
  const raw = readFileSync(p, 'utf-8');
  const lines = raw.split(/\r?\n/).filter(l => !l.trim().startsWith('#') && l.trim().length > 0);
  if (lines.length < 1) throw new Error(`No token found in ${p}`);
  return lines[0].trim();
}

export class DkgClient {
  constructor({ baseUrl, tokenPath, token, contextGraphId } = {}) {
    this.baseUrl = (baseUrl || process.env.DKG_API_URL || DEFAULT_BASE).replace(/\/+$/, '');
    this.token = token || loadToken(tokenPath);
    this.contextGraphId = contextGraphId || process.env.DKG_CONTEXT_GRAPH_ID || 'openclaw-curator';
  }

  async _request(method, path, body, extraHeaders = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
      ...extraHeaders,
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DKG ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // POST /api/knowledge-assets — create a new Knowledge Asset
  async createKnowledgeAsset(name) {
    return this._request('POST', '/api/knowledge-assets', {
      name,
      contextGraphId: this.contextGraphId
    });
  }

  // POST /api/knowledge-assets/{name}/wm/write — write quads to WM
  async writeWM(name, quads) {
    return this._request('POST', `/api/knowledge-assets/${encodeURIComponent(name)}/wm/write`, {
      quads,
      contextGraphId: this.contextGraphId
    });
  }

  // POST /api/knowledge-assets/{name}/swm/share — share to SWM
  async shareSWM(name, { entities = 'all' } = {}) {
    return this._request('POST', `/api/knowledge-assets/${encodeURIComponent(name)}/swm/share`, { entities });
  }

  // POST /api/query — SPARQL query; view = 'working-memory' | 'shared-working-memory' | 'verifiable-memory'
  async query(sparql, { view = 'working-memory', agentAddress, contextGraphId } = {}) {
    const body = { sparql, view };
    if (agentAddress) body.agentAddress = agentAddress;
    if (contextGraphId) body.contextGraphId = contextGraphId;
    return this._request('POST', '/api/query', body);
  }

  // GET /api/status
  async status() {
    return this._request('GET', '/api/status');
  }

  // Generate a fresh KA name with timestamp suffix to avoid "partition differs" seal errors.
  freshKAName(prefix = 'dkg-rag') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${ts}-${rand}`;
  }
}

// Escape a string for use as a SPARQL literal (double-quoted).
export function sparqlLiteral(value) {
  const s = String(value);
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}
