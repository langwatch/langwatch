/** How the audit table reads its rows; pure function assertions. */

import { describe, expect, it } from "vitest";

import {
  auditActionPhrase,
  auditActor,
  auditChangeSummary,
  auditClient,
  auditDayHeading,
  auditDayLabel,
  auditFeedDays,
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

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  userId: "u1",
  actorUserId: null,
  action: "authz.grants.attach",
  targetKind: null,
  targetId: null,
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
    expect(auditDayHeading({ at: new Date(2026, 9, 10, 1, 0), now })).toBe("Today · Oct 10, 2026");
    expect(auditDayHeading({ at: new Date(2026, 9, 8, 9, 0), now })).toBe("Oct 8, 2026");
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
