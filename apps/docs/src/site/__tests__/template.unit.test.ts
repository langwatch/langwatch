import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appRoot } from "../../paths.ts";

describe("the page template", () => {
  /** @scenario "Build the documentation under a base path" */
  it("writes its own links through Vite's base, so a /docs build keeps them under the mount", () => {
    const template = readFileSync(path.join(appRoot, "index.html"), "utf8");
    const links = [...template.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links).toContain("%BASE_URL%favicon.svg");
    expect(links.filter((href) => href.startsWith("/"))).toEqual([]);
  });
});
