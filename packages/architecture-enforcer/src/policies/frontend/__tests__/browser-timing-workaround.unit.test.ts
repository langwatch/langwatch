/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: ARCHITECTURE.md §17.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { lintBrowserTimingWorkarounds } from "../browser-timing-workaround.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-timing-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "modules/*/*"\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function lint() {
  return lintBrowserTimingWorkarounds(buildWorkspaceSnapshot({ root, changedFiles: [] }));
}

function found(): string[] {
  return lint().map((violation) => `${violation.line} ${violation.specifier}`);
}

const FILE = "modules/demo/browser/src/behavior/use-demo.ts";

describe("lintBrowserTimingWorkarounds", () => {
  describe("when a frame callback reschedules itself while an element is missing", () => {
    /** @scenario "A frame callback that reschedules itself until something appears is a timing workaround" */
    it("reports the self-scheduling frame", () => {
      write(
        FILE,
        `export function reveal(ref: { current: HTMLElement | null }): void {
  const poll = () => {
    const element = ref.current;
    if (!element) {
      requestAnimationFrame(poll);
      return;
    }
    element.scrollIntoView();
  };
  poll();
}
`,
      );

      expect(found()).toEqual(["5 recursive-frame"]);
    });
  });

  describe("when a frame callback animates", () => {
    /** @scenario "An animation loop is not a timing workaround" */
    it("reports nothing", () => {
      write(
        FILE,
        `export function tween(draw: (t: number) => void): () => void {
  let frame = 0;
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / 300);
    draw(t);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
`,
      );

      expect(found()).toEqual([]);
    });
  });

  describe("when a frame only defers again", () => {
    /** @scenario "A frame that only defers to another frame or a zero timeout is a timing workaround" */
    it("reports both as deferred frames", () => {
      write(
        FILE,
        `export const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
export const arm = (set: (on: boolean) => void) => requestAnimationFrame(() => requestAnimationFrame(() => set(true)));
export const focus = (input: HTMLInputElement) => requestAnimationFrame(() => input.focus());
`,
      );

      expect(found()).toEqual(["1 deferred-frame", "2 deferred-frame"]);
    });
  });

  describe("when module code queries the document", () => {
    /** @scenario "A document query in module browser code is a timing workaround" */
    it("reports only the query for a rendered element", () => {
      write(
        FILE,
        `export const focusRow = (id: string) => document.querySelector(\`[data-row="\${id}"]\`)?.focus();
export const country = () => document.querySelector('meta[name="x-country"]')?.getAttribute("content");
export function ensureStyles(): void {
  if (document.getElementById("demo-styles")) return;
  document.head.append(document.createElement("style"));
}
`,
      );

      expect(found()).toEqual(["1 document-query"]);
    });
  });

  describe("when a timer re-reads a query with growing delays", () => {
    /** @scenario "A timer re-reading a query with growing delays is a timing workaround" */
    it("reports only the growing re-read", () => {
      write(
        FILE,
        `const REREAD_DELAYS_MS = [500, 1_000, 2_000, 4_000];
export function reread(utils: Utils, count: number): () => void {
  const delay = REREAD_DELAYS_MS[count];
  const timer = setTimeout(() => {
    void utils.runs.get.invalidate();
  }, delay);
  return () => clearTimeout(timer);
}
export function retry(delay = 500): void {
  void fetch("/api/health").catch(() => setTimeout(() => retry(delay * 2), delay * 2));
}
`,
      );

      expect(found()).toEqual(["4 growing-reread"]);
    });
  });

  describe("when a finding is read", () => {
    /** @scenario "Every finding says what to write instead" */
    it("names the event to wait on and the shrink-only list", () => {
      write(FILE, 'export const row = () => document.getElementById("row");\n');
      const [violation] = lint();

      expect(violation?.allowed).toContain("ref");
      expect(violation?.allowed).toContain("tests/baselines/browser-timing-workaround.json");
    });
  });
});
