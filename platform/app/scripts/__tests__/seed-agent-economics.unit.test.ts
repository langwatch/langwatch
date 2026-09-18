import { describe, expect, it } from "vitest";

import { buildFinopsRows } from "../seed-lib/agent-economics/finops";
import { buildEntities } from "../seed-lib/agent-economics/world";
import { buildPullRequests } from "../seed-lib/agent-economics/pull-requests";
import { buildSessions, type Engineer } from "../seed-lib/agent-economics/sessions";
import { DAY_MS, fiscalYearStart, resolveToday, utcDayStart } from "../seed-lib/agent-economics/dates";

const TENANT = "local-dev-project";
const ORG = "local-dev-organization";
const TODAY = resolveToday("2026-09-07");
const MAIN_LOGIN = "drewdrewthis";
const PEERS: Engineer[] = [
  { userId: "seed-eng-sarah", name: "seed-eng-sarah", githubLogin: "sarahkim", isMain: false },
  { userId: "seed-eng-tom", name: "seed-eng-tom", githubLogin: "tomokafor", isMain: false },
];

function prConfig() {
  return { organizationId: ORG, todayMs: TODAY, mainLogin: MAIN_LOGIN, peerLogins: PEERS.map((p) => p.githubLogin) };
}
function engineers(): Engineer[] {
  return [{ userId: "local-dev-admin-user", name: "You", githubLogin: MAIN_LOGIN, isMain: true }, ...PEERS];
}
function sessionsConfig(prs: ReturnType<typeof buildPullRequests>) {
  return {
    tenantId: TENANT,
    version: "2026-08-23",
    agentVersion: "1.0.0",
    todayMs: TODAY,
    historyDays: 120,
    engineers: engineers(),
    prs,
  };
}
function finopsConfig() {
  return { tenantId: TENANT, fiscalStartMs: fiscalYearStart(TODAY), todayMs: TODAY, updatedAtMs: TODAY };
}

describe("seed-agent-economics generators", () => {
  describe("given the same today anchor and seed", () => {
    it("produces byte-identical pull requests across two builds", () => {
      const a = buildPullRequests(prConfig());
      const b = buildPullRequests(prConfig());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    });

    it("produces byte-identical sessions and event RecordIds across two builds", () => {
      const prs = buildPullRequests(prConfig());
      const a = buildSessions(sessionsConfig(prs));
      const b = buildSessions(sessionsConfig(prs));
      expect(a.sessions.map((s) => s.SessionId)).toEqual(b.sessions.map((s) => s.SessionId));
      expect(a.events.map((e) => e.RecordId)).toEqual(b.events.map((e) => e.RecordId));
      expect(JSON.stringify(a.sessions)).toBe(JSON.stringify(b.sessions));
    });

    it("produces byte-identical finops RowIds across two builds", () => {
      const a = buildFinopsRows(finopsConfig(), buildEntities());
      const b = buildFinopsRows(finopsConfig(), buildEntities());
      expect(a.map((r) => r.RowId)).toEqual(b.map((r) => r.RowId));
    });
  });

  describe("when the leak-ledger targets are planted in the last seven days", () => {
    const prs = buildPullRequests(prConfig());
    const { sessions, events } = buildSessions(sessionsConfig(prs));
    const sevenAgo = TODAY - 7 * DAY_MS;
    const eventsLast7 = events.filter((e) => (e.TimeUnixMs as Date).getTime() >= sevenAgo);
    const mainLast7 = sessions.filter(
      (s) => (s.UserId as string) === "local-dev-admin-user" && (s.StartedAt as Date).getTime() >= sevenAgo,
    );

    it("has exactly one session past 600k context (rule 2)", () => {
      const over600 = mainLast7.filter((s) => (s.PeakContextTokens as number) > 600_000);
      expect(over600).toHaveLength(1);
      expect(Math.max(...over600.map((s) => s.PeakContextTokens as number))).toBe(667_000);
    });

    it("has 141 model calls over 450k across exactly two sessions (rule 6)", () => {
      const over450 = eventsLast7.filter(
        (e) =>
          e.EventKind === "model_call" &&
          (e.CacheReadTokens as number) + (e.CacheCreationTokens as number) + (e.InputTokens as number) > 450_000,
      );
      expect(over450.length).toBe(141);
      expect(new Set(over450.map((e) => e.SessionId)).size).toBe(2);
    });

    it("has 21 rate-limit retries losing about six minutes (rule 5)", () => {
      const apiErrors = eventsLast7.filter((e) => e.EventKind === "api_error");
      expect(apiErrors.length).toBe(21);
      const retryMs = apiErrors.reduce((s, e) => s + (e.RetryDurationMs as number), 0);
      expect(retryMs).toBe(360_000);
    });

    it("has 19 cache rebuilds with the largest at 362k (rule 4)", () => {
      const rebuilds = mainLast7.reduce((s, r) => s + (r.CacheRebuildCount as number), 0);
      expect(rebuilds).toBe(19);
      expect(Math.max(...mainLast7.map((s) => s.LargestCacheRebuildTokens as number))).toBe(362_000);
    });

    it("has nine oversized tool results, seven of them whole-file Reads (rule 3)", () => {
      const big = eventsLast7.filter((e) => e.EventKind === "tool_result" && (e.ToolResultBytes as number) > 200_000);
      expect(big.length).toBe(9);
      expect(big.filter((e) => e.ToolName === "Read").length).toBe(7);
    });
  });

  describe("when generating the six most recent weeks", () => {
    it("sums in-session commits to the target weekly curve", () => {
      const prs = buildPullRequests(prConfig());
      const { sessions } = buildSessions(sessionsConfig(prs));
      const weeks = [0, 0, 0, 0, 0, 0];
      for (const s of sessions) {
        if ((s.UserId as string) !== "local-dev-admin-user") continue;
        const wk = Math.floor((utcDayStart(TODAY) - utcDayStart((s.StartedAt as Date).getTime())) / (7 * DAY_MS));
        if (wk >= 0 && wk < 6) weeks[5 - wk] += s.Commits as number;
      }
      expect(weeks).toEqual([11, 9, 6, 4, 8, 9]);
    });
  });

  describe("when bounding event volume", () => {
    it("keeps event rows under the 150k budget", () => {
      const prs = buildPullRequests(prConfig());
      const { events } = buildSessions(sessionsConfig(prs));
      expect(events.length).toBeLessThan(150_000);
    });
  });

  describe("when spanning the fiscal year to date", () => {
    it("covers Databricks, seats, cloud and activity charges", () => {
      const rows = buildFinopsRows(finopsConfig(), buildEntities());
      const charges = new Set(rows.map((r) => r.Charge));
      expect(charges).toEqual(new Set(["usage", "seat", "cloud", "activity"]));
      expect(rows.some((r) => r.Tool === "databricks")).toBe(true);
      expect(rows.some((r) => r.KeyId !== "")).toBe(true);
    });

    it("fiscal-year start precedes today", () => {
      expect(fiscalYearStart(TODAY)).toBeLessThan(TODAY);
    });
  });
});
