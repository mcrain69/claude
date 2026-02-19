const express = require('express');
const router  = express.Router();
const az      = require('../services/agencyZoom');

// Helper — wraps async route handlers and forwards errors to Express
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

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

module.exports = router;
