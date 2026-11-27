/** How the audit table reads its rows; pure function assertions. */

import { describe, expect, it } from "vitest";

import {
  auditActionPhrase,
  auditActor,
  auditChangeSummary,
  auditClient,
  auditDayHeading,
  auditDayLabel,
  auditEntryPhrase,
  auditFeedDays,
  auditTargetLine,
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
    ["governance.agent.stop_requested", "Stop requested"],
    ["governance.agent.stop_approved", "Stop approved"],
    ["governance.agent.stop_plan_set", "Stop plan set"],
    ["governance.agent.restore_requested", "Restore requested"],
    ["governance.agent.restore_failed", "Restore failed"],
    ["governance.agent.quarantined", "Quarantined agent"],
    ["governance.agent.restored", "Restored agent"],
    ["staffAccess.orgCopy", "LangWatch staff copied organization setup"],
    ["staffAccess.orgCopyPlanned", "LangWatch staff planned an organization setup copy"],
    ["staffAccess.orgCopyStopped", "LangWatch staff organization setup copy stopped"],
  ])("reads %s as %s", (action, phrase) => {
    expect(auditActionPhrase(action)).toBe(phrase);
  });
});

describe("given an action recorded before the kill switch", () => {
  /** @scenario An audit row reads as a sentence, with the recorded action kept beside it */
  it.each([
    ["organization.setMemberDisabled", "Set member disabled"],
    ["aiTools.setEnabled", "Set enabled"],
    ["virtualKeys.update", "Updated virtual key"],
    ["apiKey.create", "Created api key"],
    ["team.archive", "Archived team"],
    ["secrets.delete", "Deleted secret"],
    ["project.updateEmbeddingsModel", "Updated embeddings model"],
    ["authz.grants.revoke", "Revoked grant"],
    ["identity.joinRequests.setJoining", "Set joining"],
    ["license.upload", "License upload"],
  ])("keeps reading %s as %s", (action, phrase) => {
    expect(auditActionPhrase(action)).toBe(phrase);
  });

  /** @scenario An audit row reads as a sentence, with the recorded action kept beside it */
  it("reads a verb used as an adjective before a participle as written", () => {
    expect(auditActionPhrase("user.email.duplicate_address_tagged")).toBe(
      "Duplicate address tagged",
    );
  });
});

describe("given a row whose target is a braid", () => {
  /** @scenario A braid's entries read as braid changes */
  it.each([
    ["authz.grants.attach", "Created braid"],
    ["authz.grants.revoke", "Removed braid"],
  ])("reads %s as %s", (action, phrase) => {
    expect(auditEntryPhrase({ action, targetKind: "braid" })).toBe(phrase);
  });

  /** @scenario A braid's entries read as braid changes */
  it("keeps the generic wording for a verb a braid never records", () => {
    expect(auditEntryPhrase({ action: "authz.grants.role_change", targetKind: "braid" })).toBe(
      auditActionPhrase("authz.grants.role_change"),
    );
  });

  /** @scenario A braid's entries read as braid changes */
  it("keeps the grant wording on any other target", () => {
    expect(auditEntryPhrase({ action: "authz.grants.attach", targetKind: "role_binding" })).toBe(
      "Attached grant",
    );
    expect(auditEntryPhrase({ action: "authz.grants.attach", targetKind: null })).toBe(
      "Attached grant",
    );
  });
});

describe("given the line under a row's phrase", () => {
  /** @scenario A braid's entry row names its owner project, never its grant id */
  it("reads a braid by its owner project, or as Braid alone", () => {
    expect(
      auditTargetLine({ targetKind: "braid", targetId: "rolebinding_1", projectName: "payments" }),
    ).toEqual({ kind: "words", text: "Braid owned by payments" });
    expect(
      auditTargetLine({ targetKind: "braid", targetId: "rolebinding_1", projectName: null }),
    ).toEqual({ kind: "words", text: "Braid" });
  });

  /** @scenario A braid's entry row names its owner project, never its grant id */
  it("keeps any other target's id", () => {
    expect(
      auditTargetLine({ targetKind: "role_binding", targetId: "rolebinding_1", projectName: "p" }),
    ).toEqual({ kind: "id", id: "rolebinding_1" });
    expect(auditTargetLine({ targetKind: null, targetId: null, projectName: null })).toBeNull();
  });

  /** @scenario An entry row names its target by the name the row recorded */
  it("reads a target by its recorded name rather than its id", () => {
    expect(
      auditTargetLine({
        targetKind: "governance_agent",
        targetId: "agentreg_1",
        targetName: "Finance close",
        projectName: null,
      }),
    ).toEqual({ kind: "words", text: "Finance close" });
  });
});

describe("given a row's actor fields", () => {
  /** @scenario Each kind of actor reads distinctly */
  it("names a resolved user by name, keeping the email for the hover", () => {
    expect(
      auditActor({
        userId: "u1",
        user: { id: "u1", name: "Ada", email: "ada@x.test" },
        actorUserId: null,
        actorUser: null,
        apiKeyId: null,
      }),
    ).toEqual({ kind: "user", viaKeyId: null, id: "u1", name: "Ada", email: "ada@x.test" });
  });

  /** @scenario Each kind of actor reads distinctly */
  it("names a person who called through their own key, and a key acting as nobody", () => {
    expect(
      auditActor({
        userId: "u1",
        user: { id: "u1", name: "Ada", email: "ada@x.test" },
        actorUserId: null,
        actorUser: null,
        apiKeyId: "key_123456789",
      }),
    ).toMatchObject({ kind: "user", viaKeyId: "key_123456789" });
    expect(
      auditActor({
        userId: "apikey:key_9",
        user: null,
        actorUserId: null,
        actorUser: null,
        apiKeyId: "key_9",
      }),
    ).toEqual({ kind: "apiKey", id: "key_9" });
  });

  /** @scenario Each kind of actor reads distinctly */
  it("tells a background job, an unidentified caller and a vanished user apart", () => {
    expect(
      auditActor({ userId: null, user: null, actorUserId: null, actorUser: null, apiKeyId: null }),
    ).toEqual({
      kind: "system",
    });
    expect(
      auditActor({
        userId: "anonymous",
        user: null,
        actorUserId: null,
        actorUser: null,
        apiKeyId: null,
      }),
    ).toEqual({ kind: "anonymous" });
    expect(
      auditActor({
        userId: "u-gone",
        user: null,
        actorUserId: null,
        actorUser: null,
        apiKeyId: null,
      }),
    ).toEqual({
      kind: "unresolved",
      id: "u-gone",
    });
  });

  /** @scenario An impersonated entry names the operator as well as the person */
  it("names the operator acting as the person when the two differ", () => {
    expect(
      auditActor({
        userId: "u1",
        user: { id: "u1", name: "Alice", email: "alice@x.test" },
        actorUserId: "op",
        actorUser: { id: "op", name: "Admin", email: "admin@x.test" },
        apiKeyId: null,
      }),
    ).toEqual({
      kind: "impersonation",
      operator: { id: "op", name: "Admin", email: "admin@x.test" },
      subject: { id: "u1", name: "Alice", email: "alice@x.test" },
    });
  });
});

describe("given a row LangWatch staff or an operator wrote", () => {
  const noUser = { userId: null, user: null, actorUserId: null, actorUser: null, apiKeyId: null };

  it("names LangWatch Support, with the approving operator and the reason", () => {
    expect(
      auditActor({
        ...noUser,
        actorUserId: "u_o",
        actorUser: { id: "u_o", name: "Olivia", email: "olivia@langwatch.ai" },
        action: "staffAccess.write",
        staffAccess: {
          principal: "LangWatch Support",
          reason: "fix the broken evaluator",
          approvedBy: { id: "u_o" },
        },
      }),
    ).toEqual({
      kind: "staff",
      principal: "LangWatch Support",
      approvedBy: "olivia@langwatch.ai",
      revokedBy: null,
      reason: "fix the broken evaluator",
    });
  });

  it("keeps a staff row's own principal and reads no approver when none resolved", () => {
    expect(
      auditActor({
        ...noUser,
        action: "staffAccess.expired",
        staffAccess: { principal: "LangWatch Staff Read", reason: null },
      }),
    ).toEqual({
      kind: "staff",
      principal: "LangWatch Staff Read",
      approvedBy: null,
      revokedBy: null,
      reason: null,
    });
  });

  /** @scenario A revoked or expired staff access row names its approver, not whoever ended it */
  it("reads the approver from the row's metadata and the revoker separately", () => {
    expect(
      auditActor({
        userId: "u_o",
        user: { id: "u_o", name: "Olivia", email: "olivia@langwatch.ai" },
        actorUserId: "u_p",
        actorUser: { id: "u_p", name: "Pedro", email: "pedro@langwatch.ai" },
        apiKeyId: null,
        action: "staffAccess.revoked",
        staffAccess: {
          principal: "LangWatch Staff Read",
          reason: "check usage",
          approvedBy: { id: "u_o", name: "Olivia", email: "olivia@langwatch.ai" },
          revokedBy: { id: "u_p", name: "Pedro", email: "pedro@langwatch.ai" },
        },
      }),
    ).toMatchObject({ approvedBy: "olivia@langwatch.ai", revokedBy: "pedro@langwatch.ai" });
  });

  /** @scenario A revoked or expired staff access row names its approver, not whoever ended it */
  it("names the approver of an expired row, which has no actor", () => {
    expect(
      auditActor({
        userId: "u_o",
        user: { id: "u_o", name: "Olivia", email: "olivia@langwatch.ai" },
        actorUserId: null,
        actorUser: null,
        apiKeyId: null,
        action: "staffAccess.expired",
        staffAccess: { principal: "LangWatch Staff Read", reason: null, approvedBy: { id: "u_o" } },
      }),
    ).toMatchObject({ approvedBy: "olivia@langwatch.ai", revokedBy: null });
  });

  it("names the operator who started an impersonation, with the reason", () => {
    expect(
      auditActor({
        userId: "op",
        user: { id: "op", name: "Olivia", email: "olivia@langwatch.ai" },
        actorUserId: null,
        actorUser: null,
        apiKeyId: null,
        action: "admin/impersonate",
        args: { userIdToImpersonate: "u1", reason: "reproduce a bug report" },
      }),
    ).toEqual({
      kind: "operator",
      id: "op",
      name: "Olivia",
      email: "olivia@langwatch.ai",
      reason: "reproduce a bug report",
    });
  });

  it.each([
    ["staffAccess.approved", "Approved LangWatch staff access"],
    ["staffAccess.expired", "LangWatch staff access ended"],
    ["admin/impersonate", "Started impersonating a member"],
    ["admin/impersonate.expired", "Impersonation ended"],
  ])("reads %s as %s", (action, phrase) => {
    expect(auditActionPhrase(action)).toBe(phrase);
  });
});

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: "u1",
  actorUserId: null,
  action: "authz.grants.attach",
  targetKind: null,
  targetId: null,
  targetName: null,
  projectId: null,
  error: null,
  source: "platform" as const,
  createdAt: new Date(2026, 9, 10, 12),
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

  /** @scenario A burst of identical events by one actor reads as one row */
  it("keeps events on one target apart when the target's recorded name changed", () => {
    const named = { targetKind: "governance_aws_connection", targetId: "awsconn_1" };
    const runs = groupAuditRuns([
      row("a", { ...named, targetName: "ACME production" }),
      row("b", { ...named, targetName: "ACME production" }),
      row("c", { ...named, targetName: "ACME staging" }),
    ]);
    expect(runs.map((run) => run.entries.map((entry) => entry.id))).toEqual([["a", "b"], ["c"]]);
  });
});

describe("given entries across several days", () => {
  const now = new Date(2026, 9, 10, 15, 0);

  /** @scenario The feed reads by day */
  it("heads them Today, Yesterday, then the date", () => {
    expect(auditDayLabel({ at: new Date(2026, 9, 10, 1, 0), now })).toBe("Today");
    expect(auditDayLabel({ at: new Date(2026, 9, 9, 23, 0), now })).toBe("Yesterday");
    expect(auditDayLabel({ at: new Date(2026, 9, 8, 9, 0), now })).toBe("Oct 8");
    expect(auditDayLabel({ at: new Date(2025, 9, 8, 9, 0), now })).toBe("Oct 8, 2025");
  });

  /** @scenario The feed reads by day */
  it("pairs a relative day with its full date and spells older days out once", () => {
    const at = new Date(2026, 9, 10, 1, 0);
    expect(auditDayHeading({ at, now, locale: "en-US" })).toBe("Today · Oct 10, 2026");
    expect(auditDayHeading({ at: new Date(2026, 9, 8, 9, 0), now, locale: "en-US" })).toBe(
      "Oct 8, 2026",
    );
  });

  /** @scenario The feed reads by day */
  it("writes the date in the reader's locale", () => {
    const at = new Date(2026, 9, 8, 9, 0);
    expect(auditDayHeading({ at, now, locale: "en-GB" })).toBe("8 Oct 2026");
    expect(auditDayHeading({ at, now, locale: "de-DE" })).toBe("8. Okt. 2026");
  });

  /** @scenario The feed reads by day */
  it("keeps the runs of one day under one heading", () => {
    const days = auditFeedDays({
      rows: [
        row("a", { createdAt: new Date(2026, 9, 10, 9), userId: "u1" }),
        row("b", { createdAt: new Date(2026, 9, 10, 8), userId: "u2" }),
        row("c", { createdAt: new Date(2026, 9, 8, 8) }),
      ],
      now,
    });
    expect(days.map((day) => [day.label, day.runs.map((r) => r.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Oct 8", ["c"]],
    ]);
  });

  /** @scenario A burst of identical events by one actor reads as one row */
  it("never folds a run across midnight", () => {
    const days = auditFeedDays({
      rows: [
        row("a", { createdAt: new Date(2026, 9, 10, 0, 1) }),
        row("b", { createdAt: new Date(2026, 9, 9, 23, 59) }),
      ],
      now,
    });
    expect(days.map((day) => day.runs.map((r) => r.entries.length))).toEqual([[1], [1]]);
  });
});

describe("given a stored user agent", () => {
  /** @scenario Every entry says where it came from */
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "Chrome 129 on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox 131 on Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      "Safari 17 on iOS",
    ],
    ["curl/8.7.1", "curl"],
    ["langwatch-sdk/0.9.1", "langwatch-sdk"],
  ])("reads %s as %s", (userAgent, client) => {
    expect(auditClient(userAgent)).toBe(client);
  });

  it("reads nothing from no user agent", () => {
    expect(auditClient(null)).toBeNull();
  });
});

describe("given a before/after pair", () => {
  /** @scenario A change reads inline as its fields, old to new */
  it("spells out the first changed fields and counts the rest", () => {
    expect(
      auditChangeSummary({
        before: { baseUrl: "api.openai.com", enabled: false, models: ["a"], name: "same" },
        after: { baseUrl: "llmsim.local", enabled: true, models: ["a", "b"], name: "same" },
      }),
    ).toEqual({
      changes: [
        { field: "base url", from: "api.openai.com", to: "llmsim.local" },
        { field: "enabled", from: "false", to: "true" },
      ],
      more: 1,
    });
  });

  /** @scenario A change reads inline as its fields, old to new */
  it("reads a created or deleted target as fields from or to none", () => {
    expect(auditChangeSummary({ before: null, after: { limit: 5 } }).changes).toEqual([
      { field: "limit", from: "none", to: "5" },
    ]);
  });
});
