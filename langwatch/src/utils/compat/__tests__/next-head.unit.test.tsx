/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { extractTitleText } from "../next-head";

describe("extractTitleText", () => {
  describe("given a plain string", () => {
    it("returns the string verbatim", () => {
      expect(extractTitleText("Governance · LangWatch")).toBe(
        "Governance · LangWatch",
      );
    });
  });

  describe("given numbers and booleans", () => {
    it("coerces numbers to string and drops booleans", () => {
      expect(extractTitleText(42)).toBe("42");
      expect(extractTitleText(true)).toBe("");
      expect(extractTitleText(false)).toBe("");
    });
  });

  describe("given an array of text fragments", () => {
    it("flattens and joins them", () => {
      expect(
        extractTitleText(["LangWatch", " - ", "MyProject", " - ", "Home"]),
      ).toBe("LangWatch - MyProject - Home");
    });
  });

  describe("when children are a React Fragment with mixed text + JSX", () => {
    it("recurses into the Fragment instead of returning '[object Object]'", () => {
      const fragment = (
        <>
          LangWatch{" - "}
          <span>{"MyProject"}</span>
          {" - Settings"}
        </>
      );
      expect(extractTitleText(fragment)).toBe(
        "LangWatch - MyProject - Settings",
      );
    });
  });

  describe("when children mirror the DashboardLayout fallback shape", () => {
    it("flattens the parent-route default title without leaking '[object Object]'", () => {
      const project = { name: "Personal Workspace" };
      const currentRoute = { title: "Sessions" };
      const fallback = (
        <>
          LangWatch{project ? ` - ${project.name}` : ""}
          {currentRoute && currentRoute.title !== "Home"
            ? ` - ${currentRoute.title}`
            : ""}
        </>
      );
      const text = extractTitleText(fallback);
      expect(text).not.toContain("[object Object]");
      expect(text).toBe("LangWatch - Personal Workspace - Sessions");
    });
  });

  describe("given null / undefined children", () => {
    it("returns empty string", () => {
      expect(extractTitleText(null)).toBe("");
      expect(extractTitleText(undefined)).toBe("");
    });
  });
});
