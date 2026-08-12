import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'PORT=4173 ADMIN_PASSWORD=local-test-password-123 ADMIN_TOKEN_SECRET=local-test-token-secret-123 npm start',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
