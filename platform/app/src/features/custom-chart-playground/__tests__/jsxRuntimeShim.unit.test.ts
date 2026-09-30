/**
 * The generated `react/jsx-runtime` shim module must behave like React's own
 * `jsx`/`jsxs`/`jsxDEV` with respect to `props.children` — never spreading or
 * dropping it — so components that do `children.map(...)` work regardless of
 * how many children they receive.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import * as React from "react";
import { describe, expect, it } from "vitest";

import { buildJsxRuntimeModuleSource } from "../buildFrameHtml";

type JsxRuntime = {
  Fragment: unknown;
  jsx: (type: unknown, props: Record<string, unknown>, key?: string) => any;
  jsxs: (type: unknown, props: Record<string, unknown>, key?: string) => any;
  jsxDEV: (type: unknown, props: Record<string, unknown>, key?: string) => any;
};

function loadRuntime(): JsxRuntime {
  const esmSource = buildJsxRuntimeModuleSource("React");
  const commonJsSource = esmSource
    .replace("export const Fragment", "var Fragment")
    .replace("export function jsx", "function jsx")
    .replace("export function jsxs", "function jsxs")
    .replace("export function jsxDEV", "function jsxDEV");
  const factory = new Function(
    "window",
    `${commonJsSource}\nreturn { Fragment: Fragment, jsx: jsx, jsxs: jsxs, jsxDEV: jsxDEV };`,
  );
  return factory({ React });
}

describe("given the generated react/jsx-runtime shim module", () => {
  const runtime = loadRuntime();

  describe("when a component receives array children", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves an empty array rather than dropping it to undefined", () => {
      const element = runtime.jsx("div", { children: [] });
      expect(element.props.children).toEqual([]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a single-element array rather than unwrapping it to a scalar", () => {
      const element = runtime.jsx("div", { children: ["a"] });
      expect(element.props.children).toEqual(["a"]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a multi-element array unchanged", () => {
      const element = runtime.jsx("div", { children: ["a", "b"] });
      expect(element.props.children).toEqual(["a", "b"]);
    });
  });

  describe("when a component receives non-array children", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("preserves a scalar child unchanged", () => {
      const element = runtime.jsx("div", { children: "x" });
      expect(element.props.children).toBe("x");
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("carries no children prop when none was passed", () => {
      const element = runtime.jsx("div", {});
      expect("children" in element.props).toBe(false);
    });
  });

  describe("when a key is passed as the third argument", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("becomes the element's key, not a prop, and leaves other props intact", () => {
      const element = runtime.jsx("div", { id: "k" }, "key1");
      expect(element.key).toBe("key1");
      expect(element.props.id).toBe("k");
      const reference = React.createElement("div", { id: "k", key: "key1" });
      expect(element.key).toBe(reference.key);
      expect(Object.keys(element.props)).toEqual(Object.keys(reference.props));
    });
  });

  describe("when jsxs and jsxDEV are used instead of jsx", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("jsxs preserves array children exactly like jsx", () => {
      const element = runtime.jsxs("div", { children: ["a", "b"] });
      expect(element.props.children).toEqual(["a", "b"]);
    });

    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("jsxDEV preserves array children exactly like jsx", () => {
      const element = runtime.jsxDEV("div", { children: ["a", "b"] });
      expect(element.props.children).toEqual(["a", "b"]);
    });
  });

  describe("when Fragment is used", () => {
    /** @scenario "The JSX runtime shim preserves array children exactly" */
    it("is the same Fragment React itself exposes", () => {
      expect(runtime.Fragment).toBe(React.Fragment);
    });
  });
});
