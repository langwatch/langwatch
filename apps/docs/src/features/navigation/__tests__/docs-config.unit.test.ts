import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { docsRoot } from "../../../paths.ts";
import {
  configKeyPaths,
  DOCS_JSON_KEYS,
  FRONTMATTER_KEYS,
  valueAt,
} from "../compile/docs-config.ts";
import { CONTEXTUAL_OPTIONS } from "../model/nav.ts";

const config: unknown = JSON.parse(readFileSync(path.join(docsRoot, "docs.json"), "utf8"));

function authoredFrontmatterKeys() {
  const keys = new Set<string>();
  const files = readdirSync(docsRoot, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".mdx") && !file.split(path.sep).includes("node_modules"),
  );
  for (const file of files) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(
      readFileSync(path.join(docsRoot, file), "utf8"),
    );
    const data: unknown = match ? parse(match[1] ?? "") : null;
    if (data && typeof data === "object") for (const key of Object.keys(data)) keys.add(key);
  }
  return [...keys];
}

describe("the docs.json and frontmatter inventory", () => {
  describe("when docs.json is read", () => {
    /** @scenario "Account for every configuration and frontmatter key" */
    it("accounts for every authored key and no key that is no longer authored", () => {
      const authored = configKeyPaths({ config }).toSorted();
      expect(authored).toEqual(Object.keys(DOCS_JSON_KEYS).toSorted());
    });

    /** @scenario "Account for every configuration and frontmatter key" */
    it("holds every pinned key at the value the site implements", () => {
      const pinned = Object.entries(DOCS_JSON_KEYS).flatMap(([key, handling]) =>
        handling.status === "pinned" ? [[key, handling.value]] : [],
      );
      const actual = pinned.map(([key]) => [key, valueAt({ config, path: String(key) })]);
      expect(actual).toEqual(pinned);
    });

    /** @scenario "Account for every configuration and frontmatter key" */
    it("names only page actions the site implements", () => {
      const options = valueAt({ config, path: "contextual.options" });
      expect(CONTEXTUAL_OPTIONS).toEqual(
        expect.arrayContaining(Array.isArray(options) ? options : []),
      );
    });
  });

  describe("when every page's frontmatter is read", () => {
    /** @scenario "Account for every configuration and frontmatter key" */
    it("accounts for every key a page authors and none that no page uses", () => {
      expect(authoredFrontmatterKeys().toSorted()).toEqual(
        Object.keys(FRONTMATTER_KEYS).toSorted(),
      );
    });
  });

  describe("when a key is added without an entry", () => {
    /** @scenario "Account for every configuration and frontmatter key" */
    it("reports the new key path, with nested navigation collapsed", () => {
      const paths = configKeyPaths({
        config: {
          navigation: { anchors: [{ groups: [{ pages: [{ group: "A", hidden: true }] }] }] },
          footer: { socials: { x: "https://x.com" } },
        },
      });
      expect(paths).toContain("navigation.anchors[].*.hidden");
      expect(paths).toContain("footer.socials.x");
      expect(paths.filter((key) => !(key in DOCS_JSON_KEYS))).toEqual([
        "navigation.anchors[].*.hidden",
        "footer",
        "footer.socials",
        "footer.socials.x",
      ]);
    });
  });
});
