/**
 * ADR-177 block F: the app never lands on an aggregate nor the governance project when nobody
 * chose one; an aggregate is opened on purpose. Main's aggregate-project-landing.
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import { findLandingProjects, NEVER_LANDED_ON_PROJECT_KINDS } from "../project.kinds.ts";

const ordinary = { id: "p-app", kind: "application" };
const aggregate = { id: "p-agg", kind: "aggregate" };
const governance = { id: "p-gov", kind: "internal_governance" };

describe("the project the app lands on", () => {
  describe("given a team listing an aggregate and the governance project beside an ordinary one", () => {
    /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
    it.each([
      ["aggregate first", [aggregate, ordinary, governance]],
      ["governance first", [governance, aggregate, ordinary]],
      ["ordinary first", [ordinary, governance, aggregate]],
    ])("lands on the ordinary project, %s", (_order, projects) => {
      expect(findLandingProjects(projects)[0]?.id).toBe(ordinary.id);
    });
  });

  describe("given a team whose only projects are an aggregate and the governance project", () => {
    /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
    it("offers nothing to land on there, so landing looks elsewhere", () => {
      expect(findLandingProjects([aggregate, governance])).toEqual([]);
    });
  });

  describe("given the filter a home-page query applies", () => {
    it("names exactly the aggregate and governance kinds", () => {
      expect([...NEVER_LANDED_ON_PROJECT_KINDS].toSorted()).toEqual([
        "aggregate",
        "internal_governance",
      ]);
    });
  });
});
