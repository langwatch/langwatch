/**
 * ADR-177 decision 8: an aggregate project's navigation is Traces only.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import { projectNavigation } from "../project.kinds.ts";

describe("given the project navigation", () => {
  describe("when the open project is an aggregate", () => {
    /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
    it("shows Traces, and hides Analytics, Online Evals, Test and Build", () => {
      expect(projectNavigation("aggregate")).toEqual({
        home: false,
        observe: true,
        analytics: false,
        onlineEvaluations: false,
        test: false,
        build: false,
      });
    });
  });

  describe("when the open project is any other kind", () => {
    it.each(["application", null, undefined])("keeps the whole menu for %s", (kind) => {
      expect(projectNavigation(kind)).toEqual({
        home: true,
        observe: true,
        analytics: true,
        onlineEvaluations: true,
        test: true,
        build: true,
      });
    });
  });
});
