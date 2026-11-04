import { describe, expect, it } from "vitest";

import { failOnSkippedPages } from "../render-failures.ts";

describe("when a configured page cannot render", () => {
  /** @scenario "Reject invalid documentation" */
  it("fails the build naming every affected page", () => {
    const lines: string[] = [];
    expect(() =>
      failOnSkippedPages({
        skipped: [
          { slug: "guide/broken", reason: "render: Unexpected closing tag" },
          { slug: "api/missing", reason: "render: Unexpected closing tag" },
        ],
        log: (line) => lines.push(line),
      }),
    ).toThrow("Documentation rendering failed for 2 pages: guide/broken.mdx, api/missing.mdx");
    expect(lines).toEqual(["  2x render: Unexpected closing tag (e.g. guide/broken.mdx)"]);
  });
});

describe("when every page renders", () => {
  it("passes without reporting anything", () => {
    const lines: string[] = [];
    failOnSkippedPages({ skipped: [], log: (line) => lines.push(line) });
    expect(lines).toEqual([]);
  });
});
