import { routeHierarchy } from './routes.js';

interface Frame {
  path: string;
  overlayId?: string;
}
interface Overlay {
  id: string;
  close: () => void;
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
  private path: string;
  private publishedPath: string;

  constructor(private readonly browser: Window) {
    const paths = routeHierarchy(browser.location.pathname);
    this.path = paths.at(-1)!;
    this.publishedPath = this.path;
    const saved = framesFromState(browser.history.state);
    browser.addEventListener('popstate', this.onPopState);
    if (saved && saved.at(-1)?.path === browser.location.pathname) {
      this.frames = saved;
    } else {
      this.frames = [{ path: '/workout' }];
      // When updating an already-open app, replace its old same-document tab
      // trail from its first entry. Never traverse into another document.
      const current = browser.navigation?.currentEntry;
      const first = browser.navigation
        ?.entries()
        .find((entry) => entry.sameDocument);
      if (current && first && first.index < current.index) {
        this.initializing = true;
        this.traversing = true;
        this.goal = paths.map((path) => ({ path }));
        browser.history.go(first.index - current.index);
        return;
      }
      // Deep links get their logical parents too. Keep the entry before Spotter
      // untouched so Back at Workout belongs to the browser/operating system.
      this.write('replaceState');
      for (const path of paths.slice(1)) {
        this.frames.push({ path });
        this.write('pushState');
      }
    }
    // A reload restores the route, not a stale dialog entry.
    this.request(paths.map((path) => ({ path })));
  }

  subscribe(listener: (path: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  navigate(path: string) {
    const paths = routeHierarchy(path);
    this.path = paths.at(-1)!;
    const previous = this.overlays;
    this.overlays = [];
    for (const overlay of [...previous].reverse()) overlay.close();
    this.request(paths.map((path) => ({ path })));
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
      ...routeHierarchy(this.path).map((path) => ({ path })),
      ...this.overlays.map((overlay) => ({
        path: this.path,
        overlayId: overlay.id,
      })),
    ]);
  }

  private request(frames: Frame[]) {
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
    this.frames = frames;
    if (this.traversing) {
      this.traversing = false;
      this.reconcile();
      return;
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
