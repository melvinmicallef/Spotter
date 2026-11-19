import { routeHierarchy } from './routes.js';

interface Frame {
  path: string;
  overlayId?: string;
  exitBoundary?: true;
}
interface Overlay {
  id: string;
  close: () => void;
}

const EXIT_PROMPT_MS = 3000;
const workoutExitBoundary: Frame = { path: '/workout', exitBoundary: true };

function screenFrames(path: string): Frame[] {
  return [
    workoutExitBoundary,
    ...routeHierarchy(path).map((path) => ({ path })),
  ];
}

function framesFromState(state: unknown): Frame[] | undefined {
  const value = (
    state as {
      spotterNavigation?: { version?: unknown; frames?: unknown };
    } | null
  )?.spotterNavigation;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.frames) ||
    value.frames.length === 0
  )
    return;
  if (
    !value.frames.every(
      (frame: Frame) =>
        frame &&
        typeof frame.path === 'string' &&
        (frame.exitBoundary === undefined || frame.exitBoundary === true) &&
        (frame.overlayId === undefined || typeof frame.overlayId === 'string'),
    )
  )
    return;
  return value.frames;
}

/** Keeps native Back aligned with the screen hierarchy, with Workout at its root. */
export class AppNavigation {
  private frames: Frame[];
  private goal: Frame[] | null = null;
  private traversing = false;
  private initializing = false;
  private overlays: Overlay[] = [];
  private listeners = new Set<(path: string) => void>();
  private exitPromptListeners = new Set<(visible: boolean) => void>();
  private exitPromptTimer: number | undefined;
  private path: string;
  private publishedPath: string;

  constructor(private readonly browser: Window) {
    const target = screenFrames(browser.location.pathname);
    this.path = target.at(-1)!.path;
    this.publishedPath = this.path;
    const saved = framesFromState(browser.history.state);
    browser.addEventListener('popstate', this.onPopState);
    browser.addEventListener('pagehide', () => this.clearExitPrompt());
    browser.addEventListener('pageshow', (event) => {
      if (event.persisted && this.frames.at(-1)?.exitBoundary)
        this.restoreWorkoutEntry();
    });
    if (saved && saved.at(-1)?.path === browser.location.pathname) {
      this.frames = saved;
    } else {
      this.frames = [workoutExitBoundary];
      // When updating an already-open app, replace its old same-document tab
      // trail from its first entry. Never traverse into another document.
      const current = browser.navigation?.currentEntry;
      const first = browser.navigation
        ?.entries()
        .find((entry) => entry.sameDocument);
      if (current && first && first.index < current.index) {
        this.initializing = true;
        this.traversing = true;
        this.goal = target;
        browser.history.go(first.index - current.index);
        return;
      }
      // Keep the entry before Spotter untouched so the browser can leave from
      // the exit boundary. Reconciliation also adds parents for deep links.
      this.write('replaceState');
    }
    // A reload restores the route, not a stale dialog entry.
    this.request(target);
  }

  subscribe(listener: (path: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToExitPrompt(listener: (visible: boolean) => void) {
    this.exitPromptListeners.add(listener);
    listener(this.exitPromptTimer !== undefined);
    return () => {
      this.exitPromptListeners.delete(listener);
    };
  }

  navigate(path: string) {
    const target = screenFrames(path);
    this.path = target.at(-1)!.path;
    const previous = this.overlays;
    this.overlays = [];
    for (const overlay of [...previous].reverse()) overlay.close();
    this.request(target);
  }

  openOverlay(close: () => void) {
    const overlay = { id: crypto.randomUUID(), close };
    this.overlays.push(overlay);
    this.updateOverlays();
    return () => {
      if (!this.overlays.some((entry) => entry.id === overlay.id)) return;
      this.overlays = this.overlays.filter((entry) => entry.id !== overlay.id);
      this.updateOverlays();
    };
  }

  private updateOverlays() {
    this.request([
      ...screenFrames(this.path),
      ...this.overlays.map((overlay) => ({
        path: this.path,
        overlayId: overlay.id,
      })),
    ]);
  }

  private request(frames: Frame[]) {
    this.clearExitPrompt();
    this.goal = frames;
    if (!this.traversing) this.reconcile();
  }

  private reconcile() {
    const target = this.goal!;
    let common = 0;
    while (
      common < this.frames.length &&
      common < target.length &&
      this.frames[common]!.path === target[common]!.path &&
      this.frames[common]!.exitBoundary === target[common]!.exitBoundary &&
      this.frames[common]!.overlayId === target[common]!.overlayId
    )
      common += 1;

    // Reuse a divergent final entry (for example History -> Settings) instead
    // of adding a chronological tab trail. Ancestors below it stay canonical.
    const keep = Math.min(common + 1, target.length);
    if (this.frames.length > keep) {
      this.traversing = true;
      this.browser.history.go(keep - this.frames.length);
      return;
    }
    if (this.frames.length > common) {
      this.frames = target.slice(0, this.frames.length);
      this.write('replaceState');
    }
    for (const frame of target.slice(this.frames.length)) {
      this.frames.push(frame);
      this.write('pushState');
    }
    this.goal = null;
    this.publish();
  }

  private write(method: 'pushState' | 'replaceState') {
    this.browser.history[method](
      { spotterNavigation: { version: 1, frames: this.frames } },
      '',
      this.frames.at(-1)!.path,
    );
  }

  private publish() {
    this.path = this.frames.at(-1)!.path;
    if (this.path === this.publishedPath) return;
    this.publishedPath = this.path;
    for (const listener of this.listeners) listener(this.path);
  }

  private restoreWorkoutEntry = () => {
    // Reuse the existing Workout entry. Pushing after a native Back can make
    // browsers skip app history and would also discard any Forward routes.
    this.browser.history.forward();
  };

  private clearExitPrompt() {
    if (this.exitPromptTimer === undefined) return;
    this.browser.clearTimeout(this.exitPromptTimer);
    this.exitPromptTimer = undefined;
    for (const listener of this.exitPromptListeners) listener(false);
  }

  private onPopState = (event: PopStateEvent) => {
    if (this.initializing) {
      this.initializing = false;
      this.traversing = false;
      this.write('replaceState');
      this.reconcile();
      return;
    }
    const frames = framesFromState(event.state);
    if (!frames) return;
    const previous = this.frames;
    this.frames = frames;
    if (this.traversing) {
      this.traversing = false;
      this.reconcile();
      return;
    }
    this.clearExitPrompt();
    if (
      frames.at(-1)?.exitBoundary &&
      previous.length === 2 &&
      previous[0]?.exitBoundary
    ) {
      // Stay on the boundary briefly so a second native Back can leave Spotter.
      this.exitPromptTimer = this.browser.setTimeout(
        this.restoreWorkoutEntry,
        EXIT_PROMPT_MS,
      );
      for (const listener of this.exitPromptListeners) listener(true);
    }
    const active = new Set(frames.map((frame) => frame.overlayId));
    const closed = this.overlays.filter((overlay) => !active.has(overlay.id));
    this.overlays = this.overlays.filter((overlay) => active.has(overlay.id));
    this.path = frames.at(-1)!.path;
    for (const overlay of [...closed].reverse()) overlay.close();
    if (
      frames.some(
        (frame) =>
          frame.overlayId &&
          !this.overlays.some((overlay) => overlay.id === frame.overlayId),
      )
    ) {
      this.updateOverlays();
    } else {
      this.publish();
    }
  };
}

let navigation: AppNavigation | undefined;
export function appNavigation(): AppNavigation {
  return (navigation ??= new AppNavigation(window));
}
