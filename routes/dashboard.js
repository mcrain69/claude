const express = require('express');
const router  = express.Router();
const az      = require('../services/agencyZoom');

// Helper — wraps async route handlers and forwards errors to Express
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

/**
 * GET /api/dashboard/kpis
 * Header KPI cards — total premium, policies, new biz, renewals, leads, close rate
 */
router.get('/kpis', wrap(async (req, res) => {
  const data = await az.getKPIs();
  res.json(data);
}));

/**
 * GET /api/dashboard/trend
 * Monthly trend for the last 7 months (premium + policy count)
 */
router.get('/trend', wrap(async (req, res) => {
  const data = await az.getTrend();
  res.json(data);
}));

/**
 * GET /api/dashboard/producers
 * Top producers ranked by YTD premium
 */
router.get('/producers', wrap(async (req, res) => {
  const data = await az.getProducers();
  res.json(data);
}));

/**
 * GET /api/dashboard/pipeline
 * Lead pipeline stage counts for current month
 */
router.get('/pipeline', wrap(async (req, res) => {
  const data = await az.getPipeline();
  res.json(data);
}));

/**
 * GET /api/dashboard/activity
 * Recent activity feed (last 20 events)
 */
router.get('/activity', wrap(async (req, res) => {
  const data = await az.getActivity();
  res.json(data);
}));

/**
 * GET /api/dashboard/policy-mix
 * Policy count by line of business (YTD)
 */
router.get('/policy-mix', wrap(async (req, res) => {
  const data = await az.getPolicyMix();
  res.json(data);
}));

/**
 * GET /api/dashboard/goals
 * Monthly goal progress
 */
router.get('/goals', wrap(async (req, res) => {
  const data = await az.getGoals();
  res.json(data);
}));

/**
 * GET /api/dashboard/lead-sources
 * Leads grouped by source (Closed / Lost / Pending) — YTD
 */
router.get('/lead-sources', wrap(async (req, res) => {
  const data = await az.getLeadSources();
  res.json(data);
}));

/**
 * GET /api/dashboard/renewals-at-risk
 * Policies renewing in the next 30 days sorted by risk
 */
router.get('/renewals-at-risk', wrap(async (req, res) => {
  const data = await az.getRenewalsAtRisk();
  res.json(data);
}));

/**
 * GET /api/dashboard/all
 * Fetch every section in parallel — used on initial page load
 */
router.get('/all', wrap(async (req, res) => {
  const [
    kpis, trend, producers, pipeline,
    activity, policyMix, goals, leadSources, renewalsAtRisk,
  ] = await Promise.all([
    az.getKPIs(),
    az.getTrend(),
    az.getProducers(),
    az.getPipeline(),
    az.getActivity(),
    az.getPolicyMix(),
    az.getGoals(),
    az.getLeadSources(),
    az.getRenewalsAtRisk(),
  ]);

  res.json({ kpis, trend, producers, pipeline, activity, policyMix, goals, leadSources, renewalsAtRisk });
}));

module.exports = router;
