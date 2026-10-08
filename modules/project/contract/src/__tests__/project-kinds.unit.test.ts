/**
 * ADR-175: the shared rules the aggregate kind is held to, free functions so
 * every door and listing asks the same question; these pin the answers.
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import {
  hasTracesToShow,
  landableProjects,
  mayOpenProjectKind,
  NON_DESTINATION_PROJECT_KINDS,
  projectKindsHiddenFrom,
  receivesTraces,
  withoutAggregateCredentials,
} from "../project-kinds.ts";
import { PROJECT_KIND, projectKindSchema } from "../project.ts";

describe("given the admin-only route rule", () => {
  describe("when an aggregate is opened", () => {
    it.each(["MEMBER", "DEVELOPER", "EXTERNAL", null, void 0])(
      "refuses a caller whose organisation role is %s",
      (organizationRole) => {
        expect(mayOpenProjectKind({ kind: PROJECT_KIND.AGGREGATE, organizationRole })).toBe(false);
      },
    );

    it("lets an organisation admin in", () => {
      expect(mayOpenProjectKind({ kind: PROJECT_KIND.AGGREGATE, organizationRole: "ADMIN" })).toBe(
        true,
      );
    });
  });

  describe("when any other kind is opened", () => {
    it("leaves the decision to the ordinary permission check", () => {
      expect(
        mayOpenProjectKind({ kind: PROJECT_KIND.APPLICATION, organizationRole: "MEMBER" }),
      ).toBe(true);
    });
  });
});

describe("given the project lists", () => {
  it("hide the governance project from everyone and the aggregate from non-admins", () => {
    expect(projectKindsHiddenFrom("ADMIN")).toEqual([PROJECT_KIND.INTERNAL_GOVERNANCE]);
    for (const role of ["MEMBER", "DEVELOPER", "EXTERNAL", null]) {
      expect(projectKindsHiddenFrom(role)).toEqual([
        PROJECT_KIND.INTERNAL_GOVERNANCE,
        PROJECT_KIND.AGGREGATE,
      ]);
    }
  });
});

describe("given a trace destination", () => {
  it("refuses the aggregate and nothing else", () => {
    expect(receivesTraces(PROJECT_KIND.AGGREGATE)).toBe(false);
    expect(receivesTraces(PROJECT_KIND.APPLICATION)).toBe(true);
    expect(receivesTraces(null)).toBe(true);
  });

  it("never offers the aggregate or the governance project as a place to send traces", () => {
    expect(NON_DESTINATION_PROJECT_KINDS).toEqual([
      PROJECT_KIND.INTERNAL_GOVERNANCE,
      PROJECT_KIND.AGGREGATE,
    ]);
  });
});

describe("given the projects the app may land on", () => {
  const governance = { id: "p_gov", kind: PROJECT_KIND.INTERNAL_GOVERNANCE };
  const aggregate = { id: "p_agg", kind: PROJECT_KIND.AGGREGATE };
  const ordinary = { id: "p_app", kind: PROJECT_KIND.APPLICATION };

  /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
  it("skips the aggregate and the governance project whatever the order", () => {
    expect(landableProjects([aggregate, ordinary])).toEqual([ordinary]);
    expect(landableProjects([ordinary, aggregate])).toEqual([ordinary]);
    expect(landableProjects([governance, aggregate, ordinary])).toEqual([ordinary]);
    expect(landableProjects([governance, aggregate])).toEqual([]);
  });
});

describe("given an aggregate that received no trace of its own", () => {
  it("has traces to show, while any other kind answers its own flag", () => {
    expect(hasTracesToShow({ kind: PROJECT_KIND.AGGREGATE, firstMessage: false })).toBe(true);
    expect(hasTracesToShow({ kind: PROJECT_KIND.APPLICATION, firstMessage: false })).toBe(false);
    expect(hasTracesToShow({ kind: PROJECT_KIND.APPLICATION, firstMessage: true })).toBe(true);
  });
});

describe("given a project row with stored keys", () => {
  it("blanks both keys of an aggregate and leaves any other kind alone", () => {
    const keys = { apiKey: "sk-lw-base", lwqlKey: "lwql-key" };

    expect(withoutAggregateCredentials({ kind: PROJECT_KIND.AGGREGATE, ...keys })).toEqual({
      kind: PROJECT_KIND.AGGREGATE,
      apiKey: "",
      lwqlKey: "",
    });
    expect(withoutAggregateCredentials({ kind: PROJECT_KIND.APPLICATION, ...keys })).toEqual({
      kind: PROJECT_KIND.APPLICATION,
      ...keys,
    });
  });
});

describe("given the project kind parser", () => {
  it("accepts the aggregate kind beside the two that were there", () => {
    expect(projectKindSchema.options).toEqual([
      PROJECT_KIND.APPLICATION,
      PROJECT_KIND.INTERNAL_GOVERNANCE,
      PROJECT_KIND.AGGREGATE,
    ]);
    expect(PROJECT_KIND.AGGREGATE).toBe("aggregate");
  });
});
