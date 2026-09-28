import { describe, expect, it } from "vitest";

import { bounded, requestTiming } from "../capture";
import { stepError } from "../screens";
import { builtShell, insideDir } from "../static-ui";

const built = `<html><head><script type="module" crossorigin src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-b.css"><link rel="icon" href="/favicon.ico" /></head><body></body></html>`;

describe("Feature: visualdiff catches regressions and reports its own coverage", () => {
  describe("given a side's production build and its dev server's shell", () => {
    /** @scenario Each side is captured from a production build of its UI, or from its dev server when that fails */
    it("serves the built shell carrying the dev shell's public config, and none of its modules", () => {
      const devShell = `<head><script type="module" src="/@vite/client"></script><meta name="langwatch-public-config" content="eyJ9"></head>`;

      const shell = builtShell({ built, devShell });

      expect(shell).toContain(`src="/assets/index-a.js"`);
      expect(shell).toContain(`<meta name="langwatch-public-config" content="eyJ9"></head>`);
      expect(shell).not.toContain("@vite/client");
    });

    /** @scenario Each side is captured from a production build of its UI, or from its dev server when that fails */
    it("never answers a path outside the build", () => {
      expect(insideDir({ dir: "/built", pathname: "/assets/a.js" })).toBe("/built/assets/a.js");
      expect(insideDir({ dir: "/built", pathname: "/../etc/passwd" })).toBeUndefined();
      expect(insideDir({ dir: "/built", pathname: "/%E0%A4%A" })).toBeUndefined();
    });
  });

  describe("given a page call that never returns", () => {
    /** @scenario A request that never reports back does not hold later captures to the deadline */
    it("settles to its fallback at the bound, and names where a late request spent its time", async () => {
      const never = new Promise<number>(() => undefined);

      await expect(bounded({ work: never, millis: 10, fallback: 0 })).resolves.toBe(0);
      await expect(bounded({ work: Promise.resolve(7), millis: 10, fallback: 0 })).resolves.toBe(7);
      const timing = { startTime: 0, requestStart: 6200, responseStart: 6400, responseEnd: 6450 };
      expect(
        requestTiming({
          request: { timing: () => ({ ...timingDefaults, ...timing }) },
          total: 6500,
        }),
      ).toBe("total=6500ms queued=6200ms server=200ms body=50ms");
    });
  });
});

const timingDefaults = {
  startTime: 0,
  domainLookupStart: -1,
  domainLookupEnd: -1,
  connectStart: -1,
  secureConnectionStart: -1,
  connectEnd: -1,
  requestStart: -1,
  responseStart: -1,
  responseEnd: -1,
};

describe("Feature: visualdiff catches regressions and reports its own coverage", () => {
  describe("given a flow step whose click timed out", () => {
    /** @scenario A flow step that fails keeps what blocked it */
    it("keeps the first line and Playwright's call log, repeats dropped, capped", () => {
      const thrown = new Error(
        [
          "locator.click: Timeout 6000ms exceeded.",
          "Call log:",
          "  - waiting for getByText(/Automate/i).first()",
          '    - locator resolved to <button type="button">Automate</button>',
          "  - attempting click action",
          '    - <div role="dialog">…</div> intercepts pointer events',
          "  - retrying click action",
          '    - <div role="dialog">…</div> intercepts pointer events',
          ...Array.from({ length: 40 }, (_, index) => `    - retry ${index}`),
        ].join("\n"),
      );

      const error = stepError(thrown);

      expect(error.startsWith("locator.click: Timeout 6000ms exceeded. | waiting for")).toBe(true);
      expect(error).toContain('<div role="dialog">…</div> intercepts pointer events');
      expect(error.split(" | ")).toHaveLength(21);
      expect(error.match(/intercepts pointer events/g)).toHaveLength(1);
      expect(stepError(new Error("no field matching name\nat x"))).toBe("no field matching name");
    });
  });
});
