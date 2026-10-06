/**
 * ADR-144 decision 8: an aggregate project's navigation is Analytics and
 * Traces only.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";
import { projectNavigation } from "../projectKindNavigation";

describe("given the project navigation", () => {
  /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
  describe("when the open project is an aggregate", () => {
    it("shows Analytics and Traces, and hides Online Evals, Test and Build", () => {
      expect(projectNavigation("aggregate")).toEqual({
        home: false,
        observe: true,
        onlineEvaluations: false,
        test: false,
        build: false,
      });
    });
  });

  describe("when the open project is any other kind", () => {
    it.each(["application", null, undefined])(
      "keeps the whole menu for %s",
      (kind) => {
        expect(projectNavigation(kind)).toEqual({
          home: true,
          observe: true,
          onlineEvaluations: true,
          test: true,
          build: true,
        });
      },
    );
  });
});
