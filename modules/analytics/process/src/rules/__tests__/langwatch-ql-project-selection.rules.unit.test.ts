/**
 * The pure rules of a run's parameters: which projects a request names, how an aggregate narrows
 * to them, and what the limiting diagnostics say.
 * @see specs/lwql/query-params.feature
 */
import { LWQL_DIAGNOSTIC_CODES } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { narrowAggregate, selectNamedProjects } from "../langwatch-ql-project-selection.rules.ts";

const MEMBERS = {
  projects: [
    { id: "A", lwqlKey: "ka" },
    { id: "B", lwqlKey: "kb" },
  ],
  memberWindows: [
    { projectId: "A", from: 0 },
    { projectId: "B", from: 1_700_000_000_000 },
  ],
};

describe("selectNamedProjects with a stray string", () => {
  it("flags it instead of spreading it as a list", () => {
    const selected = selectNamedProjects({ projects: "al" as never });

    expect(selected).toMatchObject({ stray: true, all: false, named: undefined });
  });
});

describe("select", () => {
  it("flags a request that names both projectId and projects", () => {
    expect(selectNamedProjects({ projectId: "A", projects: ["B"] }).conflict).toBe(true);
  });

  it("reads projects, or the one projectId, or nothing", () => {
    expect(selectNamedProjects({ projects: ["B", "A"] }).named).toEqual(["B", "A"]);
    expect(selectNamedProjects({ projectId: "A" }).named).toEqual(["A"]);
    expect(selectNamedProjects({}).named).toBeUndefined();
  });
});

describe("narrowAggregate", () => {
  /** @scenario "QP11b A group project narrows to its members and keeps their share windows" */
  it("keeps the named member and its own window, and refuses a name outside the group", () => {
    expect(narrowAggregate({ aggregate: MEMBERS, named: ["B"] })).toEqual({
      complete: true,
      scope: {
        projects: [{ id: "B", lwqlKey: "kb" }],
        memberWindows: [{ projectId: "B", from: 1_700_000_000_000 }],
      },
    });
    expect(narrowAggregate({ aggregate: MEMBERS, named: ["Z"] }).complete).toBe(false);
  });
});

describe("the diagnostic codes", () => {
  /** @scenario "QP30 A named project the caller cannot read is refused whole, with no PROJECTS_NOT_READABLE diagnostic" */
  it("has no code for a dropped project, because an unreadable project refuses the run", () => {
    expect(LWQL_DIAGNOSTIC_CODES).not.toContain("PROJECTS_NOT_READABLE");
    expect(LWQL_DIAGNOSTIC_CODES).toContain("SHARE_WINDOW_LIMITED");
  });
});
