/**
 * The pure rules of a run's parameters: which projects a request names, how an aggregate narrows
 * to them, and what the limiting diagnostics say.
 * @see specs/lwql/query-params.feature
 */
import { LWQL_DIAGNOSTIC_CODES } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LangWatchQLProjectSelectionService } from "../../services/langwatch-ql-project-selection.service.ts";

const selection = LangWatchQLProjectSelectionService.create();

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

describe("select", () => {
  /** @scenario "QP12d A run that names both projectId and projects is refused" */
  it("refuses a request that names both projectId and projects", () => {
    expect(() => selection.select({ projectId: "A", projects: ["B"] })).toThrow(
      "send projectId or projects, not both",
    );
    expect(() => selection.select({ projectId: "A", projects: ["B"] })).toThrow(
      expect.objectContaining({ code: "validation_error", httpStatus: 422 }),
    );
  });

  it("reads projects, or the one projectId, or nothing", () => {
    expect(selection.select({ projects: ["B", "A"] }).named).toEqual(["B", "A"]);
    expect(selection.select({ projectId: "A" }).named).toEqual(["A"]);
    expect(selection.select({}).named).toBeUndefined();
  });
});

describe("narrowAggregate", () => {
  /** @scenario "QP11b A group project narrows to its members and keeps their share windows" */
  it("keeps the named member and its own window, and refuses a name outside the group", () => {
    expect(selection.narrowAggregate({ aggregate: MEMBERS, named: ["B"] })).toEqual({
      projects: [{ id: "B", lwqlKey: "kb" }],
      memberWindows: [{ projectId: "B", from: 1_700_000_000_000 }],
    });
    expect(() => selection.narrowAggregate({ aggregate: MEMBERS, named: ["Z"] })).toThrow(
      expect.objectContaining({ code: "project_not_found", httpStatus: 404 }),
    );
  });
});

describe("the diagnostic codes", () => {
  /** @scenario "QP30 A named project the caller cannot read is refused whole, with no PROJECTS_NOT_READABLE diagnostic" */
  it("has no code for a dropped project, because an unreadable project refuses the run", () => {
    expect(LWQL_DIAGNOSTIC_CODES).not.toContain("PROJECTS_NOT_READABLE");
    expect(LWQL_DIAGNOSTIC_CODES).toContain("SHARE_WINDOW_LIMITED");
  });
});
