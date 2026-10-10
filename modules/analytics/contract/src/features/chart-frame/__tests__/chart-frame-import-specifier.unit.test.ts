/**
 * How a widget's `import` specifiers are rewritten for the sandboxed ESM frame.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { describe, expect, it } from "vitest";

import {
  CHART_FRAME_BUILTIN_MODULES,
  resolveImportSpecifier,
} from "../chart-frame-import-specifier.ts";

const resolve = (specifier: string) =>
  resolveImportSpecifier(specifier, CHART_FRAME_BUILTIN_MODULES);

describe("given a widget import specifier", () => {
  describe("when it names a bare package", () => {
    /** @scenario "A bare package import resolves to esm.sh with React externalised" */
    it("resolves to esm.sh with React externalised", () => {
      expect(resolve("dayjs")).toBe("https://esm.sh/dayjs?external=react,react-dom");
    });
  });

  describe("when it names a scoped or deep package", () => {
    /** @scenario "A scoped or deep package import resolves to esm.sh unchanged" */
    it("keeps the full path under esm.sh with React externalised", () => {
      expect(resolve("@tanstack/react-table")).toBe(
        "https://esm.sh/@tanstack/react-table?external=react,react-dom",
      );
      expect(resolve("lodash-es/debounce")).toBe(
        "https://esm.sh/lodash-es/debounce?external=react,react-dom",
      );
    });

    it("appends the externalise query with & when the specifier already has one", () => {
      expect(resolve("some-pkg?bundle")).toBe(
        "https://esm.sh/some-pkg?bundle&external=react,react-dom",
      );
    });
  });

  describe("when it names a built-in module the frame provides", () => {
    /** @scenario "Built-in modules resolve to the frame's own instance" */
    it("leaves the specifier unchanged so the import map serves the UMD global", () => {
      for (const builtin of [
        "react",
        "react-dom",
        "react-dom/client",
        "recharts",
        "@langwatch/charts",
      ]) {
        expect(resolve(builtin)).toBe(builtin);
      }
    });

    /** @scenario "A package built with the automatic JSX runtime shares the frame's React" */
    it("leaves react/jsx-runtime and react/jsx-dev-runtime unchanged", () => {
      expect(resolve("react/jsx-runtime")).toBe("react/jsx-runtime");
      expect(resolve("react/jsx-dev-runtime")).toBe("react/jsx-dev-runtime");
    });
  });

  describe("when it is already a URL, data, blob or relative path", () => {
    /** @scenario "URL, data, blob and relative imports are left alone" */
    it("leaves the specifier unchanged", () => {
      for (const specifier of [
        "https://esm.sh/canvas-confetti",
        "data:text/javascript,export default 1",
        "blob:https://app/1234",
        "/absolute/helper.js",
        "./helper",
        "../shared/helper",
      ]) {
        expect(resolve(specifier)).toBe(specifier);
      }
    });
  });

  describe("when it is an http: URL", () => {
    /** @scenario "An http module URL is rejected with a clear compile error" */
    it("throws with a clear error message", () => {
      expect(() => resolve("http://example.com/x.js")).toThrow(
        'Module URLs must use https: (got "http://example.com/x.js")',
      );
    });
  });
});
