// Catch-all Vercel API entry point.
// Vercel's file-system routing does not send /api/register, /api/start, etc.
// to api/index.js automatically. This function explicitly catches every API
// path and hands it to the existing Express application.
import app from '../server.js';

export default async function handler(req, res) {
  await app.locals.ready;

  // Keep Express's /api router mounted at /api regardless of how Vercel
  // normalizes the function URL before invoking the handler.
  if (typeof req.url === 'string' && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  return app(req, res);
}
