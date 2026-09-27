/**
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKUP_DOCS } from "../checkup.service";

const DOCS_ROOT = path.resolve(__dirname, "../../../../../../docs");

const navPages = (): Set<string> => {
  const pages = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") pages.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(JSON.parse(readFileSync(path.join(DOCS_ROOT, "docs.json"), "utf8")));
  return pages;
};

describe("CHECKUP_DOCS", () => {
  describe("given the docs pages the checkup rows link to", () => {
    /** @scenario "Every docs page a checkup row links to exists" */
    it("names only pages that exist and are in the docs navigation", () => {
      const nav = navPages();
      const missing = Object.entries(CHECKUP_DOCS)
        .map(([key, docsPath]) => ({ key, page: docsPath.replace(/^\//, "") }))
        .filter(
          ({ page }) =>
            !existsSync(path.join(DOCS_ROOT, `${page}.mdx`)) || !nav.has(page),
        );

      expect(missing).toEqual([]);
    });
  });
});
