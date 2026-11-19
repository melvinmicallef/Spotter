import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'Europe/Malta' });

for (const restDay of [false, true]) {
  test(`Spotter resets the home selection to today${restDay ? ' on a rest day' : ' without changing an active workout'}`, async ({
    page,
    request,
    context,
  }) => {
    // A fixed Thursday makes the current-day and rest-day expectations explicit.
    await page.clock.setFixedTime(new Date('2026-11-19T10:00:00Z'));
    const suffix = crypto.randomUUID().slice(0, 8);
    const exerciseName = `Home press ${suffix}`;
    const exerciseResponse = await request.post('/api/exercises', {
      data: { name: exerciseName, exerciseType: 'strength', muscles: [] },
    });
    expect(exerciseResponse.ok()).toBe(true);
    const exercise = (await exerciseResponse.json()) as { id: string };
    const templateResponse = await request.post('/api/templates', {
      data: {
        name: `Home week ${suffix}`,
        isActive: true,
        exercises: (restDay ? [5] : [4, 5]).map((dayOfWeek) => ({
          exerciseId: exercise.id,
          dayOfWeek,
          targetSets: 1,
          targetReps: 8,
        })),
      },
    });
    expect(templateResponse.ok()).toBe(true);
    await page.goto('/workout');

    const todayTitle = `Thursday (${restDay ? 'Rest' : 'Workout'})`;
    const today = page.getByRole('button', { name: todayTitle, exact: true });
    const otherDay = page.getByRole('button', {
      name: 'Friday (Workout)',
      exact: true,
    });
    const home = page.getByRole('button', { name: 'Spotter', exact: true });
    for (const offline of [false, true]) {
      await context.setOffline(offline);
      await otherDay.click();
      await expect(otherDay).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('heading', { name: 'Friday (Workout)', exact: true }),
      ).toBeVisible();
      await home.locator('img').click();
      await expect(page).toHaveURL('/workout');
      await expect(today).toHaveAttribute('aria-pressed', 'true');
      await expect(otherDay).toHaveAttribute('aria-pressed', 'false');
      await expect(
        page.getByRole('heading', { name: todayTitle, exact: true }),
      ).toBeVisible();
      const start = page.getByRole('button', {
        name: "Start today's workout",
        exact: true,
      });
      if (restDay) {
        await expect(start).toBeDisabled();
        await expect(
          page.getByRole('list', { name: 'Scheduled exercises' }),
        ).toHaveCount(0);
      } else {
        await expect(start).toBeEnabled();
        await expect(
          page.getByRole('list', { name: 'Scheduled exercises' }),
        ).toContainText(exerciseName);
      }
    }

    if (!restDay) {
      await otherDay.click();
      await page
        .getByRole('button', { name: "Start Friday's workout", exact: true })
        .click();
      const weight = page.getByLabel(`${exerciseName} weight set 1`, {
        exact: true,
      });
      const reps = page.getByLabel(`${exerciseName} repetitions set 1`, {
        exact: true,
      });
      await weight.fill('25');
      await reps.fill('8');
      await home.locator('img').click();
      await expect(page.locator('.workout-active-page')).toBeVisible();
      await expect(page.locator('.workout-active-page')).toContainText(
        'Friday',
      );
      await expect(weight).toHaveValue('25');
      await expect(reps).toHaveValue('8');
    }
  });
}
