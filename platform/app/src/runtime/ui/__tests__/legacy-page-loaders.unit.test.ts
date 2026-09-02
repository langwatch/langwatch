/**
 * @vitest-environment jsdom
 *
 * The install list and the route table are two halves of one seam: the table
 * names a page, this application supplies the module. A key in the table with
 * no loader is a page that 404s the moment someone opens its URL; a loader
 * with no key in the table is a page nothing can reach any more.
 */

import { uiRoutePageKeys, uiRouteTable } from "@langwatch/ui";
import { describe, expect, it, vi } from "vitest";
import { legacyPageLoaders } from "../legacy-page-loaders";

/**
 * The shared modules are stubbed rather than imported: the assertion is about
 * which module and which export a key names, and evaluating four real screens
 * to learn that would drag their whole import graph in.
 */
const screens = vi.hoisted(() => ({
  evaluations: () => null,
  experiments: () => null,
  wizard: () => null,
  edit: () => null,
}));

vi.mock("~/pages/[project]/evaluations", () => ({
  default: screens.evaluations,
  GuardedExperimentsPage: screens.experiments,
}));
vi.mock("~/pages/[project]/evaluations/wizard", () => ({ default: screens.wizard }));
vi.mock("~/pages/[project]/evaluations/[id]/edit", () => ({ default: screens.edit }));

describe("given the browser route table and this application's page loaders", () => {
  describe("when the two are compared", () => {
    it("registers nothing the table does not name", () => {
      const named = new Set(uiRoutePageKeys(uiRouteTable));
      const unreachable = Object.keys(legacyPageLoaders).filter((key) => !named.has(key));

      expect(unreachable).toEqual([]);
    });

    it("compares the whole surface rather than two empty lists", () => {
      expect(uiRoutePageKeys(uiRouteTable).length).toBeGreaterThan(100);
    });
  });
});

describe("given the addresses that share one screen", () => {
  const sharing: ReadonlyArray<[string, () => null]> = [
    ["pages/[project]/experiments/index", screens.experiments],
    ["pages/[project]/evaluations/wizard/[slug]", screens.wizard],
    ["pages/[project]/evaluations/[id]/edit", screens.edit],
    ["pages/[project]/evaluations/[id]/edit/choose", screens.edit],
  ];

  describe("when each key is loaded", () => {
    it.each(sharing)("%s resolves the component its address serves", async (key, screen) => {
      const loader = legacyPageLoaders[key];
      if (!loader) throw new Error(`no loader registered for ${key}`);

      await expect(loader().then((module) => module.default)).resolves.toBe(screen);
    });
  });

  it("covers every key that shares a module with another", () => {
    const specifiers = sharing.map(([key]) => key);

    expect(new Set(specifiers).size).toBe(specifiers.length);
    expect(specifiers.every((key) => key in legacyPageLoaders)).toBe(true);
  });
});
