/**
 * The frame's import map, read as data: which module each built-in specifier
 * names, and that each module exports what its global really carries.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it } from "vitest";

import { buildChartsLibScript } from "../chart-frame-charts-lib-source.ts";
import {
  buildChartFrameImportMap,
  buildGlobalModuleSource,
  CHART_FRAME_GLOBAL_EXPORTS,
} from "../chart-frame-import-map.ts";

const DATA_PREFIX = "data:text/javascript;charset=utf-8,";

function moduleSourceOf(specifier: string): string {
  const url = buildChartFrameImportMap().imports[specifier] ?? "";
  return decodeURIComponent(url.slice(DATA_PREFIX.length));
}

describe("the chart frame import map", () => {
  describe("when a built-in specifier is resolved", () => {
    it("serves the UMD global as the default export and its members by name", () => {
      const source = moduleSourceOf("recharts");

      expect(source).toContain("const m = window.Recharts;");
      expect(source).toContain("export default m;");
      expect(source).toMatch(/export const \{[^}]*\bBarChart\b[^}]*\} = m;/);
    });

    it("gives react-dom and react-dom/client the one module, so one instance", () => {
      const { imports } = buildChartFrameImportMap();

      expect(imports["react-dom/client"]).toBe(imports["react-dom"]);
      expect(imports["react/jsx-dev-runtime"]).toBe(imports["react/jsx-runtime"]);
      expect(moduleSourceOf("react/jsx-runtime")).toContain("export function jsx(");
    });

    it("lists no name a module could not declare", () => {
      for (const names of Object.values(CHART_FRAME_GLOBAL_EXPORTS)) {
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(name).toMatch(/^[A-Za-z_$][\w$]*$/);
          expect(name).not.toBe("default");
        }
      }
    });
  });

  describe("when the bundled charts library is evaluated", () => {
    /** @scenario "The import map names every export of the bundled charts library" */
    it("exports exactly the members the library defines", () => {
      // The library ships as a string; evaluating it is the test.
      // oxlint-disable-next-line no-implied-eval
      const evaluate = new Function("window", `${buildChartsLibScript()}\nreturn LWCharts;`) as (
        window: object,
      ) => Record<string, unknown>;

      const members = Object.keys(evaluate({})).toSorted();

      expect([...CHART_FRAME_GLOBAL_EXPORTS.LWCharts].toSorted()).toEqual(members);
      expect(buildGlobalModuleSource("LWCharts")).toContain(`{ ${members.join(", ")} }`);
    });
  });
});
