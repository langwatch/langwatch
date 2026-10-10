/**
 * The workshop as a showcase: no published entry point without a story, every
 * story in a sidebar section, guidance on each component page, adoption counted.
 * @vitest-environment node
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { getStorySortParameter, loadCsf } from "storybook/internal/csf-tools";
import { describe, expect, it } from "vitest";

import { collectAdoption } from "../.storybook/adoption.ts";
import {
  NOT_RENDERED,
  PACKAGE_ROOT,
  publishedEntries,
  storyExists,
  storyFor,
} from "../.storybook/catalogue.ts";

const COMPONENT_SECTIONS = new Set([
  "Primitives",
  "Inputs and forms",
  "Data display",
  "Feedback",
  "Overlays",
  "Navigation and layout",
  "Chrome and app shell",
  "Brand",
]);

function storyFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return storyFiles(full);
    return entry.name.endsWith(".stories.tsx") ? [full] : [];
  });
}

const stories = storyFiles(path.join(PACKAGE_ROOT, "src")).map((file) => {
  const code = readFileSync(file, "utf8");
  const csf = loadCsf(code, { fileName: file, makeTitle: (title) => title ?? "" }).parse();
  return { file: path.relative(PACKAGE_ROOT, file), title: csf.meta?.title ?? "", code };
});

describe("the design system workshop", () => {
  describe("given the entry points package.json publishes", () => {
    /** @scenario "Every published entry point that renders has a story" */
    it("finds a story for every entry point that renders", () => {
      const undocumented = publishedEntries()
        .filter(({ subpath }) => !(subpath in NOT_RENDERED))
        .flatMap(({ subpath, source }) => {
          const story = storyFor({ source });
          return story && !storyExists({ story }) ? [`${subpath} needs ${story}`] : [];
        });

      expect(undocumented).toEqual([]);
    });

    /** @scenario "Every published entry point that renders has a story" */
    it("exempts only entry points that are still published", () => {
      const published = new Set(publishedEntries().map(({ subpath }) => subpath));

      expect(Object.keys(NOT_RENDERED).filter((subpath) => !published.has(subpath))).toEqual([]);
    });
  });

  describe("given the sidebar sections the workshop orders", () => {
    const order = getStorySortParameter(
      readFileSync(path.join(PACKAGE_ROOT, ".storybook/preview.tsx"), "utf8"),
    ) as { order: unknown[] };
    const sections = new Set(order.order.filter((item) => typeof item === "string"));

    /** @scenario "Every story is filed under a section a developer reaches for" */
    it("files every story under one of them", () => {
      const misfiled = stories
        .filter(({ title }) => !sections.has(title.split("/")[0] ?? ""))
        .map(({ file, title }) => `${file}: "${title}"`);

      expect(stories.length).toBeGreaterThan(0);
      expect(misfiled).toEqual([]);
    });
  });

  describe("given every story filed under a component section", () => {
    /** @scenario "Every component page says when to use it" */
    it("finds a usage parameter in its meta", () => {
      const silent = stories
        .filter(({ title }) => COMPONENT_SECTIONS.has(title.split("/")[0] ?? ""))
        .filter(({ code }) => !/\busage:\s*\{/.test(code))
        .map(({ file }) => file);

      expect(silent).toEqual([]);
    });
  });

  describe("when the adoption collector runs over the source tree", () => {
    const adoption = collectAdoption();

    /** @scenario "Adoption numbers are counted from the import sites" */
    it("counts the files importing each entry point and names its story", () => {
      expect(adoption.entries["./primitives"]?.files).toBeGreaterThan(0);
      expect(adoption.entries["./primitives"]?.names.Box).toBeGreaterThan(0);
      expect(adoption.entries["./tooltip"]?.story).toBe(
        "./src/components/overlays/tooltip.stories.tsx",
      );
      expect(adoption.entries["./icons"]?.story).toBe("./src/components/icons/icons.stories.tsx");
    });

    /** @scenario "Adoption numbers are counted from the import sites" */
    it("reports each kind of debt per file", () => {
      for (const debt of Object.values(adoption.debt)) {
        expect(debt.worst.length).toBeLessThanOrEqual(8);
        expect(debt.sites).toBeGreaterThanOrEqual(debt.files);
      }
    });
  });
});
