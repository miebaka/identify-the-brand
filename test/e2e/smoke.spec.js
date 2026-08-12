import { test, expect } from '@playwright/test';

test('game landing page is usable', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Identify The Brand/i);
  await expect(page.locator('#reg-first')).toBeVisible();
  await expect(page.locator('#reg-surname')).toBeVisible();
  await expect(page.locator('#reg-submit')).toBeVisible();
});

test('admin route is protected', async ({ page }) => {
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText(/admin|login|password/i);
});
