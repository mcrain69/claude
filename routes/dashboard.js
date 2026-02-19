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
 * GET /api/dashboard/all
 * Fetch every section in parallel — used on initial page load
 */
router.get('/all', wrap(async (req, res) => {
  const [
    kpis, trend, producers, pipeline, policyMix, goals,
  ] = await Promise.all([
    az.getKPIs(),
    az.getTrend(),
    az.getProducers(),
    az.getPipeline(),
    az.getPolicyMix(),
    az.getGoals(),
  ]);

  res.json({ kpis, trend, producers, pipeline, policyMix, goals });
}));

module.exports = router;
