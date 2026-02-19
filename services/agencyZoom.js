/**
 * AgencyZoom API Client
 *
 * Docs: https://developer.agencyzoom.com
 * Authentication: Bearer token via API key obtained from
 *   AgencyZoom → Settings → Integrations → API Keys
 *
 * All methods return plain JS objects/arrays ready for the dashboard.
 * Results are cached in PostgreSQL to minimise API calls.
 */

const fetch = require('node-fetch');
const { cacheGet, cacheSet } = require('../db/index');

// Spec server: https://api.agencyzoom.com  All paths: /v1/api/...
const BASE_URL = process.env.AZ_BASE_URL || 'https://api.agencyzoom.com/v1/api';
const API_KEY  = process.env.AZ_API_KEY;

// Cache TTLs (seconds)
const TTL = {
  pipeline:  180,   // 3 min — leads change often
  policyMix: 600,   // 10 min
};

// ── Low-level request ─────────────────────────────────────────────────────────

async function azFetch(path, params = {}) {
  if (!API_KEY) throw new Error('AZ_API_KEY is not set in environment variables.');

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AgencyZoom API ${res.status} on ${path}: ${body}`);
  }

  return res.json();
}

async function azPost(path, body = {}) {
  if (!API_KEY) throw new Error('AZ_API_KEY is not set in environment variables.');

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AgencyZoom API ${res.status} on POST ${path}: ${text}`);
  }

  return res.json();
}

// ── Cached wrapper ────────────────────────────────────────────────────────────

async function withCache(key, ttl, fn) {
  const cached = await cacheGet(key);
  if (cached) return cached;
  const data = await fn();
  await cacheSet(key, data, ttl);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lead pipeline stage counts by AZ lead status.
 * AgencyZoom endpoint: POST /v1/api/leads/pipeline-count (LeadSearchRequest body)
 * AZ lead statuses: 0=NEW, 1=QUOTED, 2=WON, 3=LOST, 4=CONTACTED
 * Response per call: { leadsCount: [{workflowStageId, count}] }
 * We sum all workflowStage counts to get the total for each status.
 */
async function getPipeline() {
  return withCache('pipeline:month', TTL.pipeline, async () => {
    const sumCount = d => (d?.leadsCount ?? []).reduce((s, l) => s + (l.count ?? 0), 0);

    const [newData, contactedData, quotedData, wonData, lostData] = await Promise.all([
      azPost('/leads/pipeline-count', { status: 0 }),  // NEW
      azPost('/leads/pipeline-count', { status: 4 }),  // CONTACTED
      azPost('/leads/pipeline-count', { status: 1 }),  // QUOTED
      azPost('/leads/pipeline-count', { status: 2 }),  // WON
      azPost('/leads/pipeline-count', { status: 3 }),  // LOST
    ]);

    const counts = {
      new:       sumCount(newData),
      contacted: sumCount(contactedData),
      quoted:    sumCount(quotedData),
      proposal:  0,               // No direct AZ status equivalent
      won:       sumCount(wonData),
      lost:      sumCount(lostData),
    };

    // Conversion rate = won ÷ all leads ever entered (won + active + lost)
    const total = counts.new + counts.contacted + counts.quoted;
    const allTime = total + counts.won + counts.lost;
    return {
      ...counts,
      total,
      conversionRate: allTime > 0 ? (counts.won / allTime * 100).toFixed(1) : '0.0',
    };
  });
}

/**
 * Policy count broken down by line of business.
 * No aggregate endpoint exists in the public API, so we:
 *   1. GET /v1/api/product-lines  — fetch all defined policy types
 *   2. POST /v1/api/customers (pageSize:1, policyType:id) — get totalCount
 *      of active customers per policy type as a proxy for policy count.
 * Premium is not available via this approach.
 */
async function getPolicyMix() {
  return withCache('policymix:ytd', TTL.policyMix, async () => {
    const productLines = await azFetch('/product-lines');
    // productLines: [{ id, name, productCategoryId, standardProductLineCode }]

    const lines = await Promise.all(
      productLines.map(line =>
        azPost('/customers', { policyType: line.id, pageSize: 1, status: 1 })
          .then(res => ({ label: line.name, count: res.totalCount ?? 0, premium: 0 }))
          .catch(()  => ({ label: line.name, count: 0,                  premium: 0 }))
      )
    );

    return lines.filter(l => l.count > 0);
  });
}

module.exports = {
  getPipeline,
  getPolicyMix,
};
