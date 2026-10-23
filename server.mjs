import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import handler from './api/chat.js';

const app = express();
const indexFile = fileURLToPath(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'dream-the-muse-api' });
});
// Existing handler owns CORS, preflight, authentication and JSON validation.
// Pass bounded raw JSON to it so CORS headers also accompany parsing errors.
app.all('/api/chat', express.text({ type: 'application/json', limit: 40000 }),
  (req, res, next) => Promise.resolve(handler(req, res)).catch(next));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
// Serve only the HTML file, never expose the repository root or .env.
app.get('/', (_req, res) => res.sendFile(indexFile));
app.use((_req, res) => res.status(404).send('Not found.'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.setHeader('Cache-Control', 'no-store');
  res.vary('Origin');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.get('Origin');
  if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  const status = error.type === 'entity.too.large' ? 413 : error.status === 415 ? 415 : 500;
  if (status === 500) console.error('Server error', { name: error.name });
  res.status(status).json({ error: status === 413 ? 'Request too large.' : status === 415 ? 'Unsupported encoding.' : 'Server error.' });
});
app.listen(port, '0.0.0.0', () => console.log(`Dream the Muse listening on port ${port}`));
