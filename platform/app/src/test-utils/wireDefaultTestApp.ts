import { afterAll, beforeAll, beforeEach } from "vitest";
import { globalForApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";

/**
 * Wire the App singleton for an integration test file.
 *
 * Production boots through `initializeDefaultApp()` once, and every
 * permission check then decides through `getApp().permissions` (ADR-092), so
 * a test that drives a real route or a `.permission()` procedure needs the
 * singleton populated or the request dies with "App not initialized" — a 500
 * at the boundary.
 *
 * Call it at the top level of the test file, after the imports:
 *
 * ```ts
 * wireDefaultTestApp();
 * ```
 *
 * This is deliberately NOT a vitest setup file. A setup file that imports
 * `presets.ts` loads the entire application graph into the module registry
 * before any test file's `vi.mock` is registered, so every mock underneath an
 * App service silently stops applying — even a test's own `createTestApp()`
 * call then composes against the unmocked, setup-cached modules. Importing
 * this helper from the test file keeps the composition inside that file's
 * module graph, where its mocks are honoured. (The lane's own setup chain
 * carries the same warning: "before test-setup.ts imports any application
 * code".)
 *
 * A file that composes its own App (`globalForApp.__langwatch_app =
 * createTestApp({...})` in a `beforeAll`, the #3240 pattern) does not need
 * this; its later assignment would win anyway, since this helper only fills
 * an empty slot.
 */
export function wireDefaultTestApp(): void {
  const fill = () => {
    globalForApp.__langwatch_app ??= createTestApp();
  };
  // Both hooks, deliberately. beforeAll covers a file whose own beforeAll
  // already needs the App (it runs first, registered at the top level).
  // beforeEach covers the file that wires its own App for one describe and
  // `resetApp()`s in that describe's afterAll — without the re-fill, every
  // later describe would find the slot empty. Filling is constructor-only
  // work, and a slot another hook already filled is left alone.
  beforeAll(fill);
  beforeEach(fill);
  afterAll(() => {
    globalForApp.__langwatch_app = null;
  });
}
