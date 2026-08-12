// Vercel entry point for the Express application.
// Keep the app in a dedicated /api function so Vercel does not have to infer
// the server entry point or bundle the old Netlify function.
import app from '../server.js';

export default async function handler(req, res) {
  // server.js performs logo/persistence initialization once per warm instance.
  // Wait for it before handling the request so startup failures become clear
  // function errors instead of partially initialized gameplay responses.
  await app.locals.ready;
  return app(req, res);
}
