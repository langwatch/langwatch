import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkLedger, readLedger, updateLedger } from "../checks/ledger.ts";
import { buildFixture, page, REDIRECT_PAGE } from "./build-fixture.ts";

const files = {
  "index.html": page({ slug: "introduction" }),
  "introduction/index.html": page({ slug: "introduction" }),
  "guide/index.html": page({ slug: "guide" }),
  "old/index.html": REDIRECT_PAGE,
  "redirects.json": JSON.stringify({
    "/old": "/guide",
    "/legacy/:path*": "/guide",
    "/repo": "https://github.com/langwatch/langwatch",
    "/broken": "/nowhere",
  }),
};

describe("when the published-address ledger is checked against a build", () => {
  const fixture = buildFixture({ files });
  afterAll(() => fixture.dispose());

  /** @scenario "Every published address resolves in the build" */
  it("passes pages, redirects, pattern redirects and external destinations and reports the rest", () => {
    for (const basePath of ["", "/docs"]) {
      const { issues } = checkLedger({
        index: fixture.index({ basePath }),
        ledger: [
          "/",
          "/introduction",
          "/guide",
          "/old",
          "/legacy/a/b",
          "/repo",
          "/gone",
          "/broken",
        ],
      });
      expect(issues).toEqual([
        { source: "published-urls.txt", href: "/gone", code: "unpublished" },
        { source: "published-urls.txt", href: "/broken", code: "unpublished" },
      ]);
    }
  });

  describe("when a built page is not in the ledger", () => {
    /** @scenario "A new page must be added to the ledger" */
    it("reports the page and appends it, sorted under the header, on update", () => {
      const { issues, unlisted } = checkLedger({ index: fixture.index(), ledger: ["/", "/guide"] });
      expect(unlisted).toEqual(["/introduction"]);
      expect(issues).toEqual([
        { source: "published-urls.txt", href: "/introduction", code: "unlisted-page" },
      ]);
      const ledger = path.join(fixture.outDir, "ledger.txt");
      writeFileSync(ledger, "# header\n/guide\n/\n");
      expect(updateLedger({ file: ledger, add: unlisted })).toBe(3);
      expect(readFileSync(ledger, "utf8")).toBe("# header\n/\n/guide\n/introduction\n");
      expect(readLedger({ file: ledger })).toEqual(["/", "/guide", "/introduction"]);
    });
  });
});
