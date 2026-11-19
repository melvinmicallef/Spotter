import { expect, test, type Page } from '@playwright/test';

const errorMessage = 'Please retry saving this exercise.';

async function openFailingEditor(page: Page, message = errorMessage) {
  await page.goto('/exercises/new');
  await page
    .getByLabel('Exercise name', { exact: true })
    .fill('Toast test exercise');
  await page.route('**/api/exercises', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 500,
      json: { error: { code: 'TEST_FAILURE', message } },
    });
  });
}

test('dismisses toasts after ten seconds and restarts the timer for repeated messages', async ({
  page,
}) => {
  await openFailingEditor(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const submit = page.getByRole('button', {
    name: 'Create exercise',
    exact: true,
  });
  const toast = page.getByRole('alert');
  await submit.click();
  await expect(toast).toContainText(errorMessage);
  await page.clock.fastForward(9_999);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1);
  await expect(toast).toHaveCount(0);

  await submit.click();
  await expect(toast).toBeVisible();
  await page.clock.fastForward(9_000);
  await submit.click();
  await expect(submit).toBeEnabled();
  await page.clock.fastForward(1_000);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(9_000);
  await expect(toast).toHaveCount(0);

  await submit.click();
  await expect(toast).toBeVisible();
  await page.clock.fastForward(5_000);
  await toast.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(toast).toHaveCount(0);
  await submit.click();
  await expect(toast).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(toast).toHaveCount(0);
});

test('centers portrait phone toasts and keeps long messages and close buttons within the viewport', async ({
  page,
}) => {
  await openFailingEditor(page, `${errorMessage} ${'LongMessage'.repeat(40)}`);
  await page
    .getByRole('button', { name: 'Create exercise', exact: true })
    .click();
  const toast = page.getByRole('alert');
  await expect(toast).toBeVisible();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const box = (await toast.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(14);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 14);
    await expect(
      toast.getByRole('button', { name: 'Dismiss message' }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  for (const [width, height] of [
    [1280, 844],
    [740, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(toast).toHaveCSS('right', '22px');
    await expect(toast).toHaveCSS('transform', 'none');
  }
  await toast.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(toast).toHaveCount(0);
});
