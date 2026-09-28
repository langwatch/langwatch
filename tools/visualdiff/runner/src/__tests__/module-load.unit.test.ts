import { describe, expect, it } from "vitest";

import { isModuleConsoleError, isModuleRequest, needsRecapture } from "../module-load";
import type { CaptureMessage } from "../protocol";
import { runPoolWithRecapture } from "../schedule";

const origin = "https://app.visualdiff-1-candidate.langwatch.localhost";

const capture = (overrides: Partial<CaptureMessage>): CaptureMessage => ({
  type: "capture",
  kind: "route",
  key: "/{slug}/datasets",
  index: 0,
  label: "/{slug}/datasets",
  side: "candidate",
  url: `${origin}/local-dev-project/datasets`,
  screenshot: "/shots/x.png",
  consoleErrors: [],
  failedRequests: [],
  notFound: false,
  blank: false,
  ariaSnapshot: "",
  error: "",
  durationMs: 10,
  ...overrides,
});

describe("Feature: a capture the dev server spoiled is the tool's failure, not the screen's", () => {
  describe("given the requests a page made", () => {
    /** @scenario A screen whose modules still did not load is a capture failure, not a blank page */
    it("counts a Vite module path or a script from the page's own origin as a module", () => {
      expect(
        isModuleRequest({
          url: `${origin}/@fs/repo/modules/x/browser/src/ui/page.tsx`,
          resourceType: "fetch",
          origin,
        }),
      ).toBe(true);
      expect(
        isModuleRequest({ url: `${origin}/src/main.tsx`, resourceType: "script", origin }),
      ).toBe(true);
    });

    /** @scenario A screen whose modules still did not load is a capture failure, not a blank page */
    it("leaves another origin's script and the page's own API calls alone", () => {
      expect(
        isModuleRequest({ url: "https://cdn.example.com/a.js", resourceType: "script", origin }),
      ).toBe(false);
      expect(isModuleRequest({ url: `${origin}/api/trpc/x`, resourceType: "fetch", origin })).toBe(
        false,
      );
    });

    /** @scenario A screen whose modules still did not load is a capture failure, not a blank page */
    it("reads the browser's failed dynamic import as a module failure", () => {
      expect(
        isModuleConsoleError("TypeError: Failed to fetch dynamically imported module: /src/x.tsx"),
      ).toBe(true);
      expect(isModuleConsoleError("Warning: Each child in a list should have a unique key")).toBe(
        false,
      );
    });
  });

  describe("given a capture", () => {
    /** @scenario A blank capture or one whose modules failed to load is taken again alone */
    it("takes a blank page or a failed module load again, and keeps a rendered one", () => {
      expect(needsRecapture(capture({ blank: true }))).toBe(true);
      expect(
        needsRecapture(
          capture({ moduleFailures: ["FAIL GET /@fs/x.tsx net::ERR_HTTP2_PROTOCOL_ERROR"] }),
        ),
      ).toBe(true);
      expect(needsRecapture(capture({}))).toBe(false);
    });
  });

  describe("given a pool where one capture comes back spoiled", () => {
    /** @scenario A blank capture or one whose modules failed to load is taken again alone */
    it("keeps only its retake, taken on the first lane after every other capture", async () => {
      const taken: string[] = [];
      const kept: string[] = [];
      let busy = 0;
      let retakeRanAlone = false;
      const held = await runPoolWithRecapture({
        items: ["/a", "/b", "/c", "/d"],
        width: 2,
        take: async ({ item, lane }) => {
          busy += 1;
          const attempt = taken.filter((key) => key.startsWith(item)).length;
          taken.push(`${item}@${lane}`);
          if (attempt > 0) retakeRanAlone = busy === 1 && lane === 0;
          await new Promise((resolve) => setTimeout(resolve, 2));
          busy -= 1;
          return { key: item, spoiled: item === "/b" && attempt === 0 };
        },
        spoiled: (result) => result.spoiled,
        keep: (result) => kept.push(result.key),
      });

      expect(held).toEqual(["/b"]);
      expect(kept.toSorted()).toEqual(["/a", "/b", "/c", "/d"]);
      expect(kept.at(-1)).toBe("/b");
      expect(retakeRanAlone).toBe(true);
    });
  });
});
