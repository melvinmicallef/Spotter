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
        preparation: 'Set up the bench.',
        execution: 'Press with control.',
        comments: 'Keep a steady tempo.',
        referenceUrl: 'https://example.com/exercise',
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

test('opens the shared exercise guide on click in template details and editor without saving', async ({
  page,
  request,
}) => {
  const { template, exercise, noMedia, media } = await createPlan(request);
  for (const suffix of ['', '/edit']) {
    await page.goto(`/templates/${template.id}${suffix}`);
    const title = page.getByRole('button', {
      name: `Preview ${exercise.name}`,
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

    // Pointer-down alone does not open a preview; a completed click does.
    await title.hover();
    await page.mouse.down();
    await expect(title).toHaveCSS('outline-style', 'none');
    await expect(dialog).toHaveCount(0);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('img', {
        name: `${exercise.name} demonstration`,
        exact: true,
      }),
    ).toHaveAttribute('src', media.url);
    await expect(
      dialog.getByRole('img', {
        name: `${exercise.name} demonstration`,
        exact: true,
      }),
    ).toHaveJSProperty('naturalWidth', 1);
    await expect(
      dialog.getByRole('heading', { name: exercise.name, exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText('Set up the bench.');
    await expect(dialog).toContainText('Press with control.');
    await expect(dialog).toContainText('Keep a steady tempo.');
    await expect(dialog).toContainText('Shoulders › Deltoid › Anterior');
    await expect(dialog.getByRole('link')).toHaveCount(0);
    const close = dialog.getByRole('button', {
      name: 'Close exercise details',
    });
    await expect(close).toHaveText('×');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await dialog
      .getByRole('img', { name: `${exercise.name} demonstration`, exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(title).toBeFocused();

    await title.click();
    await expect(dialog).toBeVisible();
    // Stay inside the backdrop, clear of the desktop scrollbar gutter.
    await page.mouse.click(25, 5);
    await expect(dialog).toHaveCount(0);
    await expect(title).toBeFocused();
    // Native keyboard activation is a normal toggle, not a hold gesture.
    for (const key of ['Space', 'Enter']) {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await title.focus();
      await expect(title).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press(key);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(title).toBeFocused();
    }
    await page
      .getByRole('button', { name: `Preview ${noMedia.name}`, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText('Press with control.');
    await expect(
      page.getByRole('dialog').getByRole('img', {
        name: `${noMedia.name} demonstration`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    if (suffix) {
      await expect(
        page.getByLabel('Template name', { exact: true }),
      ).toHaveValue('Unsaved draft');
      await expect(
        page.getByLabel(`${exercise.name} target reps on Monday`),
      ).toHaveValue('12');
    }
    const templates = (await (
      await request.get('/api/templates')
    ).json()) as Array<{
      id: string;
      name: string;
      exercises: Array<{ targetReps: number }>;
    }>;
    const original = templates.find((item) => item.id === template.id)!;
    expect(original.name).toBe(template.name);
    expect(original.exercises.map((entry) => entry.targetReps)).toEqual([8, 8]);
  }
});

test.describe('phone previews', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('opens previews with a tap on template names or anywhere on workout cards and dismisses outside', async ({
    page,
    request,
  }) => {
    const { template, exercise } = await createPlan(request, true);
    for (const route of [
      `/templates/${template.id}`,
      `/templates/${template.id}/edit`,
      '/workout',
    ]) {
      await page.goto(route);
      if (route === '/workout') {
        await page
          .getByRole('button', { name: 'Monday (Workout)', exact: true })
          .click();
      }
      const trigger = page.getByRole('button', {
        name: `Preview ${exercise.name}`,
        exact: true,
      });
      const dialog = page.getByRole('dialog', {
        name: exercise.name,
        exact: true,
      });
      await trigger.scrollIntoViewIfNeeded();
      // Normal touch scrolling remains available on preview triggers.
      await expect(trigger).toHaveCSS('touch-action', 'auto');
      await expect(trigger).toHaveCSS('user-select', 'none');
      await expect(trigger).toHaveCSS(
        '-webkit-tap-highlight-color',
        'rgba(0, 0, 0, 0)',
      );
      const originalColor = await trigger.evaluate(
        (button) => getComputedStyle(button).color,
      );
      const box = (await trigger.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height - 4);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Press with control.');
      await expect(
        dialog.getByRole('button', { name: 'Close exercise details' }),
      ).toBeVisible();
      const preview = (await dialog.boundingBox())!;
      expect(preview.x).toBeGreaterThanOrEqual(0);
      expect(preview.x + preview.width).toBeLessThanOrEqual(390);
      expect(preview.y).toBeGreaterThanOrEqual(0);
      expect(preview.y + preview.height).toBeLessThanOrEqual(844);
      await dialog
        .getByRole('img', {
          name: `${exercise.name} demonstration`,
          exact: true,
        })
        .tap();
      await expect(dialog).toBeVisible();
      await page.touchscreen.tap(5, 5);
      await expect(dialog).toHaveCount(0);
      if (route === '/workout')
        await expect(trigger).toHaveCSS('color', originalColor);
      await trigger.tap();
      await dialog
        .getByRole('button', { name: 'Close exercise details' })
        .tap();
      await expect(dialog).toHaveCount(0);
      if (route === '/workout') {
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveCSS('outline-style', 'none');
        await expect(trigger).toHaveCSS('color', originalColor);
      }
      await expect(page.locator('.workout-active-page')).toHaveCount(0);
    }
    await page.getByRole('button', { name: /^Start .*workout$/ }).click();
    await expect(page.locator('.workout-active-page')).toBeVisible();
    const remove = page.getByRole('button', {
      name: `Remove ${exercise.name}`,
      exact: true,
    });
    await expect(remove).toHaveCSS(
      '-webkit-tap-highlight-color',
      'rgba(0, 0, 0, 0)',
    );
    await remove.tap();
    await expect(remove).toHaveCSS('outline-style', 'none');
    const confirmation = page.getByRole('alertdialog');
    const close = confirmation.getByRole('button', {
      name: 'Close removal confirmation',
    });
    await expect(close).toHaveCSS(
      '-webkit-tap-highlight-color',
      'rgba(0, 0, 0, 0)',
    );
    await close.tap();
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator('article.workout-card')).toHaveCount(2);
  });
});

test('shows workout cards below Start with muscle subheadings and exercise guides offline', async ({
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
    name: `Preview ${exercise.name}`,
    exact: true,
  });
  const emptyCard = list.getByRole('button', {
    name: `Preview ${noMedia.name}`,
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
  const originalColor = await card.evaluate(
    (button) => getComputedStyle(button).color,
  );
  await card.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
      exact: true,
    }),
  ).toHaveAttribute('src', media.url);
  await expect(
    dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
      exact: true,
    }),
  ).toHaveJSProperty('naturalWidth', 1);
  await expect(dialog).toContainText('Press with control.');
  // Back closes the guide while the mouse is still over the card.
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS('color', originalColor);
  await emptyCard.click();
  await expect(page.getByRole('dialog')).toContainText('Press with control.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.workout-active-page')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Tuesday (Rest)', exact: true })
    .click();
  await expect(list).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Start .*workout$/ }),
  ).toBeDisabled();
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
  await card.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
      exact: true,
    }),
  ).toHaveJSProperty('naturalWidth', 1);
  await expect(dialog).toContainText('Press with control.');
  await page.mouse.click(25, 5);
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^Start .*workout$/ }).click();
  await expect(page.locator('.workout-active-page')).toBeVisible();
  await page
    .getByRole('button', { name: `How to do ${exercise.name}`, exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Press with control.');
  await expect(
    dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
      exact: true,
    }),
  ).toHaveJSProperty('naturalWidth', 1);
  await dialog.getByRole('button', { name: 'Close exercise details' }).click();
});

test('opens and dismisses the cached template demonstration offline', async ({
  page,
  request,
  context,
}) => {
  const { template, exercise, media } = await createPlan(request);
  await page.goto(`/templates/${template.id}`);
  const title = page.getByRole('button', {
    name: `Preview ${exercise.name}`,
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
  await title.click();
  const dialog = page.getByRole('dialog', { name: exercise.name, exact: true });
  await expect(
    dialog.getByRole('img', {
      name: `${exercise.name} demonstration`,
      exact: true,
    }),
  ).toHaveJSProperty('naturalWidth', 1);
  await expect(dialog).toContainText('Press with control.');
  await page.mouse.click(25, 5);
  await expect(dialog).toHaveCount(0);
  await expect(title).toBeFocused();
});
