import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

test.use({ timezoneId: 'Europe/Malta' });

async function createPlan(request: APIRequestContext) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const exerciseResponse = await request.post('/api/exercises', {
    data: {
      name: `Navigation press ${suffix}`,
      exerciseType: 'strength',
      preparation: 'Set up for the press.',
      muscles: [],
    },
  });
  expect(exerciseResponse.ok()).toBe(true);
  const exercise = (await exerciseResponse.json()) as {
    id: string;
    name: string;
  };
  const templateResponse = await request.post('/api/templates', {
    data: {
      name: `Navigation plan ${suffix}`,
      isActive: true,
      exercises: [
        { exerciseId: exercise.id, dayOfWeek: 4, targetSets: 1, targetReps: 8 },
      ],
    },
  });
  expect(templateResponse.ok()).toBe(true);
  const template = (await templateResponse.json()) as {
    id: string;
    name: string;
  };
  return { exercise, template };
}

async function tab(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: label, exact: false })
    .click();
}

async function backTo(page: Page, path: string) {
  await page.goBack();
  await expect(page).toHaveURL(path);
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
}

test('main tabs go Back to Workout and root Back leaves Spotter instead of revisiting tabs', async ({
  page,
}) => {
  await page.route('https://outside.example.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Outside Spotter</title><p>Outside Spotter</p>',
    }),
  );
  await page.goto('https://outside.example.test/');
  await page.goto('/workout');
  for (const label of ['Settings', 'Exercises', 'History'])
    await tab(page, label);
  await expect(page).toHaveURL('/history');
  await backTo(page, '/workout');
  for (const label of [
    'Muscles',
    'Templates',
    'Settings',
    'History',
    'Exercises',
  ]) {
    await tab(page, 'Settings');
    await tab(page, label);
    await backTo(page, '/workout');
  }
  await tab(page, 'Templates');
  await tab(page, 'History');
  await tab(page, 'Workout');
  await expect(page).toHaveURL('/workout');
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('https://outside.example.test/');
  await expect(page.getByText('Outside Spotter')).toBeVisible();
});

test('replaces an old same-document tab trail without touching the page before Spotter', async ({
  page,
}) => {
  await page.route('https://outside.example.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Outside Spotter</title>',
    }),
  );
  await page.goto('https://outside.example.test/');
  await page.addInitScript(() => {
    if (location.pathname === '/workout' && !history.state?.spotterNavigation) {
      history.pushState(null, '', '/settings');
      history.pushState(null, '', '/templates');
      history.pushState(null, '', '/history');
    }
  });
  await page.goto('/workout');
  await expect(page).toHaveURL('/history');
  await expect(
    page.getByRole('heading', { name: 'History', exact: true }),
  ).toBeVisible();
  await backTo(page, '/workout');
  await page.goBack();
  await expect(page).toHaveURL('https://outside.example.test/');
});

test('deep links, reloads, screen back buttons, and tab changes preserve logical parents', async ({
  page,
  request,
}) => {
  const { exercise, template } = await createPlan(request);
  for (const [collection, item] of [
    ['exercises', exercise],
    ['templates', template],
  ] as const) {
    await page.goto(`/${collection}/${item.id}/edit`);
    await expect(
      page.getByRole('button', { name: /Save changes|Save weekly template/ }),
    ).toBeVisible();
    const length = await page.evaluate(() => history.length);
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Save changes|Save weekly template/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(length);
    await backTo(page, `/${collection}/${item.id}`);
    await expect(
      page.getByRole('heading', { name: item.name, exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`/${collection}/${item.id}/edit`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(`/${collection}/${item.id}`);
    await backTo(page, `/${collection}`);
    await backTo(page, '/workout');

    await page.goto(`/${collection}/new`);
    await backTo(page, `/${collection}`);
    await backTo(page, '/workout');
    await page.goto(`/${collection}/${item.id}/edit`);
    await tab(page, 'History');
    await expect(page).toHaveURL('/history');
    await backTo(page, '/workout');
  }
  await page.goto(`/history/${crypto.randomUUID()}`);
  await expect(
    page.getByText('This workout is not available on this device.'),
  ).toBeVisible();
  await backTo(page, '/history');
  await backTo(page, '/workout');
  await page
    .getByRole('button', { name: 'Show stretching', exact: true })
    .click();
  await expect(page).toHaveURL('/stretching');
  await page
    .getByRole('button', { name: 'Open settings', exact: true })
    .click();
  await expect(page).toHaveURL('/settings');
  await backTo(page, '/workout');
  await page.goto(`/templates/${template.id}/edit`);
  await expect(page.getByLabel('Template name', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .evaluate((nav) => {
      const links = Array.from(nav.querySelectorAll('a'));
      links.find((link) => link.getAttribute('href') === '/history')!.click();
      links.find((link) => link.getAttribute('href') === '/settings')!.click();
    });
  await expect(page).toHaveURL('/settings');
  await backTo(page, '/workout');
});

test('Back closes dialogs first and preserves an active workout through offline navigation', async ({
  page,
  request,
  context,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-19T10:00:00Z'));
  const { exercise, template } = await createPlan(request);
  await page.goto('/workout');
  await page
    .getByRole('button', { name: `Preview ${exercise.name}`, exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Set up for the press.');
  await backTo(page, '/workout');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: "Start today's workout", exact: true })
    .click();
  const reps = page.getByLabel(`${exercise.name} repetitions set 1`, {
    exact: true,
  });
  await reps.fill('8');
  for (const label of [
    'Cancel workout',
    `Remove ${exercise.name}`,
    '+ Add exercise',
    `How to do ${exercise.name}`,
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(
      page.locator('[role="dialog"], [role="alertdialog"]'),
    ).toBeVisible();
    await backTo(page, '/workout');
    await expect(
      page.locator('[role="dialog"], [role="alertdialog"]'),
    ).toHaveCount(0);
    await expect(reps).toHaveValue('8');
  }
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect(reps).toHaveValue('8');
  await context.setOffline(true);
  await tab(page, 'Settings');
  await tab(page, 'History');
  await backTo(page, '/workout');
  await expect(reps).toHaveValue('8');
  await page
    .getByRole('button', { name: `How to do ${exercise.name}`, exact: true })
    .click();
  await backTo(page, '/workout');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(reps).toHaveValue('8');
  await context.setOffline(false);

  await page.goto(`/templates/${template.id}/edit`);
  await page
    .getByLabel('Template name', { exact: true })
    .fill('Unsaved navigation draft');
  await page
    .getByRole('button', { name: 'Swap workout days', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await backTo(page, `/templates/${template.id}/edit`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Template name', { exact: true })).toHaveValue(
    'Unsaved navigation draft',
  );
  await page.getByLabel('Add exercise to Thursday', { exact: true }).click();
  await backTo(page, `/templates/${template.id}/edit`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Template name', { exact: true })).toHaveValue(
    'Unsaved navigation draft',
  );
  await page
    .getByRole('button', { name: `Preview ${exercise.name}`, exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Template name', { exact: true })).toHaveValue(
    template.name,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await backTo(page, `/templates/${template.id}`);
});
