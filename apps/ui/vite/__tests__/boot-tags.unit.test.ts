import { describe, expect, it } from "vitest";

import { markBootTags } from "../boot-tags";

const BUILT_HEAD = [
  '<script async src="https://edge.example/.webmcp/bridge.js"></script>',
  '<script type="module" crossorigin src="/assets/core-x.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/runtime-x.js">',
  '<link rel="stylesheet" crossorigin href="/assets/core-x.css">',
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
].join("\n");

describe("given the page the build writes", () => {
  describe("when its tags are marked", () => {
    /** @scenario "The build marks the application's own files for the boot recovery" */
    it("marks every tag that loads a built asset file, and only those", () => {
      const marked = markBootTags({ html: BUILT_HEAD }).split("\n");

      expect(marked).toEqual([
        '<script async src="https://edge.example/.webmcp/bridge.js"></script>',
        '<script data-lw-boot type="module" crossorigin src="/assets/core-x.js"></script>',
        '<link data-lw-boot rel="modulepreload" crossorigin href="/assets/runtime-x.js">',
        '<link data-lw-boot rel="stylesheet" crossorigin href="/assets/core-x.css">',
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      ]);
    });

    it("marks a tag once, however often the page passes through", () => {
      const once = markBootTags({ html: BUILT_HEAD });

      expect(markBootTags({ html: once })).toBe(once);
    });
  });
});
