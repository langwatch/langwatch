/**
 * The generated `react/jsx-runtime` must treat `props.children` as React's own
 * does — never spreading or dropping it.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { buildJsxRuntimeModuleSource } from "@langwatch/analytics-contract/chart-frame-document";
import * as React from "react";
import { describe, expect, it } from "vitest";

type JsxElement = { key: string | null; props: Record<string, unknown> };
type JsxFactory = (type: unknown, props: Record<string, unknown>, key?: string) => JsxElement;
type JsxRuntime = {
  Fragment: unknown;
  jsx: JsxFactory;
  jsxs: JsxFactory;
  jsxDEV: JsxFactory;
};

function loadRuntime(): JsxRuntime {
  const esmSource = buildJsxRuntimeModuleSource("React");
  const commonJsSource = esmSource
    .replace("export const Fragment", "var Fragment")
    .replace("export function jsx", "function jsx")
    .replace("export function jsxs", "function jsxs")
    .replace("export function jsxDEV", "function jsxDEV");
  // The module ships as a string; evaluating it is the test.
  // oxlint-disable-next-line no-implied-eval
  const factory = new Function(
    "window",
    `${commonJsSource}\nreturn { Fragment: Fragment, jsx: jsx, jsxs: jsxs, jsxDEV: jsxDEV };`,
  ) as (window: { React: typeof React }) => JsxRuntime;
  return factory({ React });
}

describe("given the generated react/jsx-runtime shim module", () => {
  const runtime = loadRuntime();

  describe("when a component receives array children", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves an empty array rather than dropping it to undefined", () => {
      expect(runtime.jsx("div", { children: [] }).props.children).toEqual([]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a single-element array rather than unwrapping it to a scalar", () => {
      expect(runtime.jsx("div", { children: ["a"] }).props.children).toEqual(["a"]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a multi-element array unchanged", () => {
      expect(runtime.jsx("div", { children: ["a", "b"] }).props.children).toEqual(["a", "b"]);
    });
  });

  describe("when a component receives non-array children", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a scalar child unchanged", () => {
      expect(runtime.jsx("div", { children: "x" }).props.children).toBe("x");
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("carries no children prop when none was passed", () => {
      expect("children" in runtime.jsx("div", {}).props).toBe(false);
    });
  });

  describe("when a key is passed as the third argument", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("becomes the element's key, not a prop, and leaves other props intact", () => {
      const element = runtime.jsx("div", { id: "k" }, "key1");
      const reference = React.createElement("div", { id: "k", key: "key1" });

      expect(element.key).toBe("key1");
      expect(element.props.id).toBe("k");
      expect(element.key).toBe(reference.key);
      expect(Object.keys(element.props)).toEqual(Object.keys(reference.props));
    });
  });

  describe("when jsxs and jsxDEV are used instead of jsx", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("jsxs preserves array children exactly like jsx", () => {
      expect(runtime.jsxs("div", { children: ["a", "b"] }).props.children).toEqual(["a", "b"]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("jsxDEV preserves array children exactly like jsx", () => {
      expect(runtime.jsxDEV("div", { children: ["a", "b"] }).props.children).toEqual(["a", "b"]);
    });
  });

  describe("when Fragment is used", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("is the same Fragment React itself exposes", () => {
      expect(runtime.Fragment).toBe(React.Fragment);
    });
  });
});
