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
  kpis:      300,   // 5 min
  trend:     600,   // 10 min
  producers: 300,
  pipeline:  180,   // 3 min — leads change often
  policyMix: 600,
  goals:     300,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function ytdRange() {
  const now = new Date();
  return {
    start_date: `${now.getFullYear()}-01-01`,
    end_date:   now.toISOString().slice(0, 10),
  };
}

function monthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    start_date: `${y}-${m}-01`,
    end_date:   `${y}-${m}-${lastDay}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * KPI summary for the YTD header cards.
 * NOTE: The public AgencyZoom API has no aggregate reporting endpoint.
 * The DashboardData/SalesProgress schemas exist in the spec but their
 * path is not published. This will 404 until AZ provides the endpoint.
 */
async function getKPIs() {
  return withCache('kpis:ytd', TTL.kpis, async () => {
    const { start_date, end_date } = ytdRange();
    const data = await azFetch('/reports/summary', { start_date, end_date });

    // Normalise to dashboard shape
    return {
      totalPremium:    data.total_premium_written   ?? 0,
      totalPolicies:   data.total_policies_issued   ?? 0,
      newBusinessPrem: data.new_business_premium    ?? 0,
      renewalPrem:     data.renewal_premium         ?? 0,
      leadsThisMonth:  data.leads_this_month        ?? 0,
      closeRate:       data.close_rate_30d          ?? 0,
      // YoY deltas returned as decimal fractions e.g. 0.124 = +12.4%
      deltaTotal:      data.delta_total_premium     ?? null,
      deltaPolicies:   data.delta_total_policies    ?? null,
      deltaNewBiz:     data.delta_new_business      ?? null,
      deltaRenewal:    data.delta_renewals          ?? null,
      deltaLeads:      data.delta_leads             ?? null,
      deltaClose:      data.delta_close_rate        ?? null,
    };
  });
}

/**
 * Monthly premium & policy count for the last 7 months.
 * NOTE: No equivalent endpoint in the public AgencyZoom API spec.
 * Will 404 until AZ exposes an aggregate trend endpoint.
 */
async function getTrend() {
  return withCache('trend:7m', TTL.trend, async () => {
    const data = await azFetch('/reports/trend', { period: 'monthly', months: 7 });

    // Expect: { months: [{label, new_business_premium, renewal_premium,
    //                      new_business_policies, renewal_policies}] }
    return (data.months ?? []).map(m => ({
      label:           m.label,
      newBizPremium:   m.new_business_premium  ?? 0,
      renewalPremium:  m.renewal_premium       ?? 0,
      newBizPolicies:  m.new_business_policies ?? 0,
      renewalPolicies: m.renewal_policies      ?? 0,
    }));
  });
}

/**
 * Top producers ranked by YTD premium.
 * NOTE: GET /v1/api/employees lists producers but has no sales metrics.
 * No aggregate sales-by-producer report exists in the public API.
 * Will 404 until AZ exposes a producer performance endpoint.
 */
async function getProducers() {
  return withCache('producers:ytd', TTL.producers, async () => {
    const { start_date, end_date } = ytdRange();
    const data = await azFetch('/reports/producers', { start_date, end_date });

    return (data.producers ?? []).map(p => ({
      id:        p.id,
      name:      p.name,
      initials:  p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      premium:   p.total_premium   ?? 0,
      policies:  p.total_policies  ?? 0,
      closeRate: p.close_rate      ?? 0,
    }));
  });
}

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

/**
 * Goal progress for the current month.
 * NOTE: No goals endpoint exists in the public AgencyZoom API spec.
 * Will 404 until AZ exposes a goals/progress endpoint.
 */
async function getGoals() {
  return withCache('goals:month', TTL.goals, async () => {
    const data = await azFetch('/goals/current');

    // Expect: { goals: [{name, target, achieved, unit}] }
    return (data.goals ?? []).map(g => ({
      name:     g.name,
      target:   g.target,
      achieved: g.achieved,
      unit:     g.unit,       // 'currency' | 'count' | 'percent'
      pct:      g.target > 0 ? Math.round((g.achieved / g.target) * 100) : 0,
    }));
  });
}

module.exports = {
  getKPIs,
  getTrend,
  getProducers,
  getPipeline,
  getPolicyMix,
  getGoals,
};
