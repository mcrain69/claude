require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { cachePurge } = require('./db/index');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve the dashboard HTML from the project root
app.use(express.static(path.join(__dirname)));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/dashboard', require('./routes/dashboard'));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} →`, err.message);
  res.status(500).json({ error: err.message });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Cache maintenance ─────────────────────────────────────────────────────────
// Purge expired cache rows every 10 minutes
setInterval(() => {
  cachePurge().catch(err => console.error('Cache purge error:', err.message));
}, 10 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`AgencyZoom Dashboard running → http://localhost:${PORT}`);
});
