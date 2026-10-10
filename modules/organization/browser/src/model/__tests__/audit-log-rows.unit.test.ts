/** How the audit table reads its rows; pure function assertions. */

import { describe, expect, it } from "vitest";

import {
  auditActionPhrase,
  auditActor,
  auditOptionalColumns,
  groupAuditRuns,
} from "../audit-log-rows.ts";

describe("given a recorded action slug", () => {
  /** @scenario An audit row reads as a sentence, with the recorded action kept beside it */
  it.each([
    ["authz.grants.attach", "Attached grant"],
    ["authz.grants.role_defined", "Defined role"],
    ["modelProvider.update", "Updated model provider"],
    ["governancePeople.runMatch", "Ran match"],
    ["gateway.budget.created", "Created budget"],
    ["gateway.virtual_key.guardrail_attached", "Attached guardrail"],
    ["routingPolicy.personalContext", "Routing policy personal context"],
  ])("reads %s as %s", (action, phrase) => {
    expect(auditActionPhrase(action)).toBe(phrase);
  });
});

describe("given a row's actor fields", () => {
  /** @scenario Each kind of actor reads distinctly */
  it("names a resolved user by name, keeping the email for the hover", () => {
    expect(
      auditActor({ userId: "u1", user: { id: "u1", name: "Ada", email: "ada@x.test" } }),
    ).toEqual({ kind: "user", id: "u1", name: "Ada", email: "ada@x.test" });
  });

  /** @scenario Each kind of actor reads distinctly */
  it("tells a background job, an unidentified caller and a vanished user apart", () => {
    expect(auditActor({ userId: null, user: null })).toEqual({ kind: "system" });
    expect(auditActor({ userId: "anonymous", user: null })).toEqual({ kind: "anonymous" });
    expect(auditActor({ userId: "u-gone", user: null })).toEqual({
      kind: "unresolved",
      id: "u-gone",
    });
  });
});

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: "u1",
  action: "authz.grants.attach",
  targetKind: null,
  targetId: null,
  projectId: null,
  error: null,
  source: "platform" as const,
  ...overrides,
});

describe("given consecutive identical events", () => {
  /** @scenario A burst of identical events by one actor reads as one row */
  it("folds back-to-back runs and keeps a different event between them apart", () => {
    const runs = groupAuditRuns([
      row("a"),
      row("b"),
      row("c"),
      row("d", { userId: "u2" }),
      row("e"),
    ]);
    expect(runs.map((run) => run.entries.map((entry) => entry.id))).toEqual([
      ["a", "b", "c"],
      ["d"],
      ["e"],
    ]);
  });

  /** @scenario A burst of identical events by one actor reads as one row */
  it("never folds a failed attempt into a successful one", () => {
    const runs = groupAuditRuns([row("a"), row("b", { error: "FORBIDDEN" })]);
    expect(runs).toHaveLength(2);
  });
});

describe("given a page of rows", () => {
  /** @scenario Columns no row on the page fills are not shown */
  it("shows target and project only when some row fills them", () => {
    expect(auditOptionalColumns([row("a")])).toEqual({ target: false, project: false });
    expect(
      auditOptionalColumns([row("a"), row("b", { targetKind: "budget", targetId: "b1" })]),
    ).toEqual({ target: true, project: false });
  });
});
