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

const BASE_URL = process.env.AZ_BASE_URL || 'https://api.agencyzoom.com/v1';
const API_KEY  = process.env.AZ_API_KEY;

// Cache TTLs (seconds)
const TTL = {
  kpis:       300,   // 5 min
  trend:      600,   // 10 min
  producers:  300,
  pipeline:   180,   // 3 min — leads change often
  activity:    60,   // 1 min — near-real-time
  policyMix:  600,
  goals:      300,
  sources:    600,
  renewals:   300,
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
 * AgencyZoom endpoint: GET /reports/summary
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
 * AgencyZoom endpoint: GET /reports/trend
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
 * AgencyZoom endpoint: GET /reports/producers
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
 * Lead pipeline stage counts for this month.
 * AgencyZoom endpoint: GET /leads/pipeline
 */
async function getPipeline() {
  return withCache('pipeline:month', TTL.pipeline, async () => {
    const { start_date, end_date } = monthRange();
    const data = await azFetch('/leads/pipeline', { start_date, end_date });

    // Expect: { stages: [{name, count}] }
    const stageMap = {};
    (data.stages ?? []).forEach(s => { stageMap[s.name] = s.count; });

    const total = stageMap['new'] ?? 0;
    return {
      new:       stageMap['new']       ?? 0,
      contacted: stageMap['contacted'] ?? 0,
      quoted:    stageMap['quoted']    ?? 0,
      proposal:  stageMap['proposal']  ?? 0,
      won:       stageMap['won']       ?? 0,
      lost:      stageMap['lost']      ?? 0,
      total,
      conversionRate: total > 0 ? ((stageMap['won'] ?? 0) / total * 100).toFixed(1) : '0.0',
    };
  });
}

/**
 * Recent activity events (last 20).
 * AgencyZoom endpoint: GET /activities
 */
async function getActivity() {
  return withCache('activity:recent', TTL.activity, async () => {
    const data = await azFetch('/activities', { limit: 20, sort: 'occurred_at:desc' });

    return (data.activities ?? []).map(a => ({
      id:           a.id,
      type:         a.type,        // policy_bound | lead_created | renewal_confirmed | quote_sent | policy_lost | endorsement
      description:  a.description,
      producerName: a.producer_name,
      premium:      a.premium ?? null,
      occurredAt:   a.occurred_at,
    }));
  });
}

/**
 * Policy count broken down by line of business (YTD).
 * AgencyZoom endpoint: GET /reports/policy-mix
 */
async function getPolicyMix() {
  return withCache('policymix:ytd', TTL.policyMix, async () => {
    const { start_date, end_date } = ytdRange();
    const data = await azFetch('/reports/policy-mix', { start_date, end_date });

    // Expect: { lines: [{line_of_business, count, premium}] }
    return (data.lines ?? []).map(l => ({
      label:   l.line_of_business,
      count:   l.count   ?? 0,
      premium: l.premium ?? 0,
    }));
  });
}

/**
 * Goal progress for the current month.
 * AgencyZoom endpoint: GET /goals/current
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

/**
 * Leads grouped by source YTD (Closed / Lost / Pending).
 * AgencyZoom endpoint: GET /reports/lead-sources
 */
async function getLeadSources() {
  return withCache('lead-sources:ytd', TTL.sources, async () => {
    const { start_date, end_date } = ytdRange();
    const data = await azFetch('/reports/lead-sources', { start_date, end_date });

    // Expect: { sources: [{source, closed, lost, pending}] }
    return (data.sources ?? []).map(s => ({
      source:  s.source,
      closed:  s.closed  ?? 0,
      lost:    s.lost    ?? 0,
      pending: s.pending ?? 0,
    }));
  });
}

/**
 * Policies renewing in the next 30 days, sorted by risk score.
 * AgencyZoom endpoint: GET /policies/renewals-at-risk
 */
async function getRenewalsAtRisk() {
  return withCache('renewals-at-risk:30d', TTL.renewals, async () => {
    const data = await azFetch('/policies/renewals-at-risk', { days_ahead: 30 });

    // Expect: { policies: [{id, insured_name, line_of_business, premium,
    //                        renewal_date, risk_level, producer_name}] }
    return (data.policies ?? []).map(p => ({
      id:           p.id,
      insuredName:  p.insured_name,
      line:         p.line_of_business,
      premium:      p.premium,
      renewalDate:  p.renewal_date,
      riskLevel:    p.risk_level,   // 'high' | 'medium' | 'low'
      producerName: p.producer_name,
    }));
  });
}

module.exports = {
  getKPIs,
  getTrend,
  getProducers,
  getPipeline,
  getActivity,
  getPolicyMix,
  getGoals,
  getLeadSources,
  getRenewalsAtRisk,
};
