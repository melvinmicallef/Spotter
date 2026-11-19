import { expect, test, type APIRequestContext } from '@playwright/test';

// Two-frame, looping red/blue GIF. Keep the original animation URL in the preview.
const demonstration = Buffer.from(
  '47494638396101000100800000ff00000000ff' +
    '21ff0b4e45545343415045322e300301000000' +
    '21f90400140000002c0000000001000100000202440100' +
    '21f90400140000002c00000000010001000002024c01003b',
  'hex',
);

async function createPlan(request: APIRequestContext, isActive = false) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const mediaResponse = await request.post('/api/media/image', {
    headers: { 'Content-Type': 'image/gif' },
    data: demonstration,
  });
  expect(mediaResponse.ok()).toBe(true);
  const media = (await mediaResponse.json()) as { id: string; url: string };
  const muscles = (await (await request.get('/api/muscles')).json()) as Array<{
    id: string;
    group: string;
    subgroup: string | null;
    name: string;
  }>;
  const target = muscles.find(
    (muscle) =>
      muscle.group === 'Shoulders' &&
      muscle.subgroup === 'Deltoid' &&
      muscle.name === 'Anterior',
  )!;

  async function createExercise(name: string, mediaId: string | null) {
    const response = await request.post('/api/exercises', {
      data: {
        name,
        exerciseType: 'strength',
        mediaId,
        muscles: mediaId ? [{ muscleId: target.id, role: 'primary' }] : [],
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { id: string; name: string };
  }
  const exercise = await createExercise(`Preview press ${suffix}`, media.id);
  const noMedia = await createExercise(`No media ${suffix}`, null);
  const templateResponse = await request.post('/api/templates', {
    data: {
      name: `Preview plan ${suffix}`,
      isActive,
      exercises: [exercise, noMedia].map((item) => ({
        exerciseId: item.id,
        dayOfWeek: 1,
        targetSets: 3,
        targetReps: 8,
      })),
    },
  });
  expect(templateResponse.ok()).toBe(true);
  const template = (await templateResponse.json()) as {
    id: string;
    name: string;
  };
  return { template, exercise, noMedia, media };
}

test('previews on mouse and keyboard hold in template details and editor without saving', async ({
  page,
  request,
}) => {
  const { template, exercise, noMedia, media } = await createPlan(request);
  for (const suffix of ['', '/edit']) {
    await page.goto(`/templates/${template.id}${suffix}`);
    const title = page.getByRole('button', {
      name: `Hold to preview ${exercise.name}`,
      exact: true,
    });
    const dialog = page.getByRole('dialog', {
      name: exercise.name,
      exact: true,
    });
    await expect(title).toBeVisible();
    if (suffix) {
      await page
        .getByLabel('Template name', { exact: true })
        .fill('Unsaved draft');
      await page
        .getByLabel(`${exercise.name} target reps on Monday`)
        .fill('12');
    }

    await title.hover();
    await expect(dialog).toHaveCount(0);
    await page.mouse.down();
    await expect(dialog).toBeVisible();
    const image = dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
    });
    await expect(image).toHaveAttribute('src', media.url);
    await expect(image).toHaveJSProperty('naturalWidth', 1);
    await page.mouse.move(5, 5);
    await expect(dialog).toBeVisible();
    await page.mouse.up();
    await expect(dialog).toHaveCount(0);
    // A completed click must never leave the preview latched open or submit.
    await title.click();
    await expect(dialog).toHaveCount(0);

    for (const key of ['Space', 'Enter']) {
      await title.focus();
      await page.keyboard.down(key);
      await expect(dialog).toBeVisible();
      await page.keyboard.up(key);
      await expect(dialog).toHaveCount(0);
    }
    await title.focus();
    await page.keyboard.down('Space');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.up('Space');

    await title.hover();
    await page.mouse.down();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(dialog).toHaveCount(0);
    await page.mouse.up();

    const emptyTitle = page.getByRole('button', {
      name: `Hold to preview ${noMedia.name}`,
      exact: true,
    });
    await emptyTitle.focus();
    await page.keyboard.down('Space');
    await expect(page.getByRole('dialog')).toContainText(
      'No demonstration available.',
    );
    await page.keyboard.up('Space');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    if (suffix) {
      await expect(
        page.getByLabel('Template name', { exact: true }),
      ).toHaveValue('Unsaved draft');
      await expect(
        page.getByLabel(`${exercise.name} target reps on Monday`),
      ).toHaveValue('12');
    }
    const saved = await request.get(`/api/templates`);
    const templates = (await saved.json()) as Array<{
      id: string;
      name: string;
      exercises: Array<{ targetReps: number }>;
    }>;
    const original = templates.find((item) => item.id === template.id)!;
    expect(original.name).toBe(template.name);
    expect(original.exercises.map((entry) => entry.targetReps)).toEqual([8, 8]);
  }
});

test.describe('phone holds', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('keeps the preview open during a long touch, suppresses selection, and closes on release or cancellation', async ({
    page,
    request,
    context,
  }) => {
    const { template, exercise } = await createPlan(request);
    const touch = await context.newCDPSession(page);
    for (const suffix of ['', '/edit']) {
      await page.goto(`/templates/${template.id}${suffix}`);
      const title = page.getByRole('button', {
        name: `Hold to preview ${exercise.name}`,
        exact: true,
      });
      await title.scrollIntoViewIfNeeded();
      await expect(title).toHaveCSS('user-select', 'none');
      await expect(title).toHaveCSS('touch-action', 'none');
      // A native context menu must be cancelled even on browsers that emit it.
      expect(
        await title.evaluate((element) =>
          element.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
          ),
        ),
      ).toBe(false);

      const box = (await title.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      });
      const dialog = page.getByRole('dialog', {
        name: exercise.name,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      // Cross the native long-press threshold with a real Chromium touch held.
      await page.waitForTimeout(900);
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
        '',
      );
      const preview = (await dialog.boundingBox())!;
      expect(preview.x).toBeGreaterThanOrEqual(0);
      expect(preview.x + preview.width).toBeLessThanOrEqual(390);
      expect(preview.y).toBeGreaterThanOrEqual(0);
      expect(preview.y + preview.height).toBeLessThanOrEqual(844);
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 5, y: 5 }],
      });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect(dialog).toHaveCount(0);

      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      });
      await expect(dialog).toBeVisible();
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchCancel',
        touchPoints: [],
      });
      await expect(dialog).toHaveCount(0);
    }
  });

  test('holds anywhere on a scheduled workout card without selecting text or starting a workout', async ({
    page,
    request,
    context,
  }) => {
    const { exercise } = await createPlan(request, true);
    await page.goto('/workout');
    await page
      .getByRole('button', { name: 'Monday (Workout)', exact: true })
      .click();
    const card = page.getByRole('button', {
      name: `Hold to preview ${exercise.name}`,
      exact: true,
    });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveCSS('user-select', 'none');
    await expect(card).toHaveCSS('touch-action', 'none');
    const box = (await card.boundingBox())!;
    // Hold empty card padding, outside both the exercise name and muscle text.
    const point = { x: box.x + box.width - 8, y: box.y + box.height - 8 };
    const touch = await context.newCDPSession(page);
    const dialog = page.getByRole('dialog', {
      name: exercise.name,
      exact: true,
    });
    for (const end of ['touchEnd', 'touchCancel'] as const) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(900);
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
        '',
      );
      await touch.send('Input.dispatchTouchEvent', {
        type: end,
        touchPoints: [],
      });
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.workout-active-page')).toHaveCount(0);
    }
    await page.getByRole('button', { name: /^Start .*workout$/ }).click();
    await expect(page.locator('.workout-active-page')).toBeVisible();
  });
});

test('shows scheduled exercise cards with muscle subheadings and offline hold previews before starting', async ({
  page,
  request,
  context,
}) => {
  const { template, exercise, noMedia, media } = await createPlan(
    request,
    true,
  );
  await page.goto('/workout');
  await page
    .getByRole('button', { name: 'Monday (Workout)', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: template.name, exact: true }),
  ).toBeVisible();
  const list = page.getByRole('list', {
    name: 'Scheduled exercises',
    exact: true,
  });
  const card = list.getByRole('button', {
    name: `Hold to preview ${exercise.name}`,
    exact: true,
  });
  const emptyCard = list.getByRole('button', {
    name: `Hold to preview ${noMedia.name}`,
    exact: true,
  });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText(exercise.name);
  await expect(card.locator('strong')).toHaveText(exercise.name);
  await expect(card.locator('small')).toHaveText(
    'Shoulders › Deltoid › Anterior',
  );
  await expect(emptyCard.locator('small')).toHaveText('No target muscles');
  await expect(list).not.toContainText('[');
  await expect(list).toHaveCSS('list-style-type', 'none');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const start = (await page
      .getByRole('button', { name: /^Start .*workout$/ })
      .boundingBox())!;
    const scheduled = (await list.boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(scheduled.y);
    const name = (await card.locator('strong').boundingBox())!;
    const muscles = (await card.locator('small').boundingBox())!;
    expect(muscles.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }

  const dialog = page.getByRole('dialog', { name: exercise.name, exact: true });
  await card.hover();
  await page.mouse.down();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveAttribute('src', media.url);
  await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
  await emptyCard.focus();
  await page.keyboard.down('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    'No demonstration available.',
  );
  await page.keyboard.up('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workout-active-page')).toHaveCount(0);

  // Cards track the selected day, including an empty rest day.
  await page
    .getByRole('button', { name: 'Tuesday (Rest)', exact: true })
    .click();
  await expect(list).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Start .*workout$/ }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Monday (Workout)', exact: true })
    .click();
  await expect(card).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await page
    .getByRole('button', { name: 'Monday (Workout)', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        const cached = await caches.match(url);
        return Boolean(navigator.serviceWorker.controller && cached?.ok);
      }, media.url),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole('button', { name: 'Monday (Workout)', exact: true })
    .click();
  await expect(card.locator('small')).toHaveText(
    'Shoulders › Deltoid › Anterior',
  );
  await card.focus();
  await page.keyboard.down('Space');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
  await page.keyboard.up('Space');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.workout-active-page')).toHaveCount(0);
  await page.getByRole('button', { name: /^Start .*workout$/ }).click();
  await expect(page.locator('.workout-active-page')).toBeVisible();
});

test('previews the cached demonstration after reloading template details offline', async ({
  page,
  request,
  context,
}) => {
  const { template, exercise, media } = await createPlan(request);
  await page.goto(`/templates/${template.id}`);
  const title = page.getByRole('button', {
    name: `Hold to preview ${exercise.name}`,
    exact: true,
  });
  await expect(title).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect(title).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        const cached = await caches.match(url);
        return Boolean(navigator.serviceWorker.controller && cached?.ok);
      }, media.url),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await title.focus();
  await page.keyboard.down('Space');
  const dialog = page.getByRole('dialog', { name: exercise.name, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
  await page.keyboard.up('Space');
  await expect(dialog).toHaveCount(0);
});
