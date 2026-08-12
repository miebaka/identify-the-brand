// Netlify serverless adapter for the existing Express application.
// Netlify rewrites /api/* to this function, while Express continues to own
// routing, validation, timing and response formatting.
import serverless from 'serverless-http';
import app from '../../server.js';

const proxy = serverless(app, {
  requestId: 'x-nf-request-id',
});

export async function handler(event, context) {
  // server.js initialises the logo registry and persistence asynchronously.
  // Do not allow a cold-start request to race that initialisation.
  await app.locals.ready;
  return proxy(event, context);
}
