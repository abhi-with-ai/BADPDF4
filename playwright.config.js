// Run: npm run test:e2e   (starts the server on :5000 unless E2E_BASE_URL is set)
const { defineConfig } = require('@playwright/test');
const base = process.env.E2E_BASE_URL || 'http://localhost:5000';
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: base, acceptDownloads: true },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'npm start', url: base + '/', reuseExistingServer: true, timeout: 60_000 },
});
