// Netlify serverless adapter for the existing Express application.
// Netlify rewrites /api/* to this function, while Express continues to own
// routing, validation, timing and response formatting.
import serverless from 'serverless-http';
import app from '../../server.js';

export const handler = serverless(app, {
  requestId: 'x-nf-request-id',
});
