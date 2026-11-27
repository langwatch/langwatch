/**
 * The platform ops functions end to end through the module: request, passkey approval, redeem,
 * call. Peers are stand-ins (support/staff-access-platform-peers.ts) over the memory twins.
 * @see modules/staff-access/specs/staff-access-functions-platform.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import {
  ACME,
  type requestBody,
  staffAccessWorld,
  codeOf,
  redeemedSession,
} from "./support/staff-access-world.ts";

type Scopes = Parameters<typeof requestBody>[0]["scopes"];
type World = ReturnType<typeof staffAccessWorld>;

const ACME_PROJECT = `${ACME.id}_project`;

function world(): World {
  return staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });
}

/** A redeemed session naming `functions`, and a caller for them. */
async function caller(w: World, { scopes, functions }: { scopes: Scopes; functions: string[] }) {
  const session = await redeemedSession({ world: w, scopes, functions });
  return (name: string, input: unknown = {}) => w.app.callFunction({ session, name, input });
}

const opsRead = (w: World, functions: string[]) => caller(w, { scopes: ["ops:read"], functions });

describe("the platform ops functions", () => {
  describe("given a redeemed ops:read session naming releases.state", () => {
    /** @scenario "releases.state answers the release each live service runs" */
    it("answers the releases, the step counts and one row per serving role and release", async () => {
      const w = world();
      const call = await opsRead(w, ["releases.state"]);

      const answered = await call("releases.state");

      expect(answered.output).toMatchObject({
        installedRelease: "3.23.0",
        imageRelease: "3.24.0",
        imageCommit: "abc1234def",
        upgradeState: "failed",
        stepsByStatus: { done: 12, failed: 1, other: 2 },
        failedTargets: 1,
        lastRunOutcome: "failed",
        lastRunFinishedAt: "2026-11-02T09:10:00.000Z",
        services: {
          items: expect.arrayContaining([
            {
              role: "api",
              release: "3.24.0",
              imageTag: "3.24.0",
              processes: 2,
              since: "2026-11-01T08:00:00.000Z",
              lastSeenAt: "2026-11-02T09:59:00.000Z",
            },
            {
              role: "worker",
              release: "3.24.0",
              imageTag: "3.24.0",
              processes: 1,
              since: "2026-11-01T08:00:00.000Z",
              lastSeenAt: "2026-11-02T09:59:00.000Z",
            },
          ]),
          total: 2,
          truncated: false,
        },
      });
      const text = JSON.stringify(answered.output);
      expect(text).not.toContain("ip-10-0-0-1");
      expect(text).not.toContain("ghcr.io");
      expect(text).not.toContain("sha256");
    });

    /** @scenario "releases.state answers only allowlisted settings" */
    it("answers the Langy mirror project id as set, and no other setting", async () => {
      const w = world();
      const call = await opsRead(w, ["releases.state"]);

      const answered = await call("releases.state");

      expect((answered.output as { settings: unknown }).settings).toEqual({
        items: [{ key: "langy.mirror_project_id", set: true, value: "project_langy_mirror" }],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
    });

    /** @scenario "releases.state says when an allowlisted setting is not set" */
    it("answers the Langy mirror project id as not set, with no value", async () => {
      const w = world();
      w.state.platform.mirrorProjectId = null;
      const call = await opsRead(w, ["releases.state"]);

      const answered = await call("releases.state");

      expect((answered.output as { settings: { items: unknown[] } }).settings.items).toEqual([
        { key: "langy.mirror_project_id", set: false, value: null },
      ]);
    });
  });

  describe("given a redeemed ops:read session naming upgrade.step_failures", () => {
    /** @scenario "upgrade.step_failures answers failed steps and the tenants a step parked" */
    it("answers the failed step's code and the parked step's tenants, never error text", async () => {
      const w = world();
      const call = await opsRead(w, ["upgrade.step_failures"]);

      const answered = await call("upgrade.step_failures");

      expect(answered.output).toMatchObject({
        items: expect.arrayContaining([
          {
            stepId: "trace:backfill-costs",
            mode: "blocking",
            state: "failed",
            attempt: 2,
            errorCode: "clickhouse_timeout",
            failedTenants: 0,
            tenantIds: [],
            lastAttemptAt: "2026-11-02T09:10:00.000Z",
            tenantScanComplete: true,
          },
          {
            stepId: "dataset:move-records",
            mode: "tenant",
            state: "parked",
            attempt: 0,
            errorCode: null,
            failedTenants: 3,
            tenantIds: ["project_parked_00", "project_parked_01", "project_parked_02"],
            lastAttemptAt: "2026-11-02T09:20:00.000Z",
            tenantScanComplete: true,
          },
        ]),
        total: 2,
      });
      const text = JSON.stringify(answered.output);
      expect(text).not.toContain("SELECT");
      expect(text).not.toContain("row too large");
      expect(text).not.toContain("ACME");
    });

    /** @scenario "upgrade.step_failures narrows to one step" */
    it("answers only the step it was asked for", async () => {
      const w = world();
      const call = await opsRead(w, ["upgrade.step_failures"]);

      const answered = await call("upgrade.step_failures", { stepId: "dataset:move-records" });

      const items = (answered.output as { items: { stepId: string }[] }).items;
      expect(items.map((item) => item.stepId)).toEqual(["dataset:move-records"]);
    });
  });

  describe("given a redeemed org:metadata session on ACME naming org.retention", () => {
    /** @scenario "org.retention answers retention days and traces per month for each project" */
    it("answers retention days, 12 months of traces, the oldest month and pending rewrites", async () => {
      const w = world();
      const call = await caller(w, { scopes: ["org:metadata"], functions: ["org.retention"] });

      const answered = await call("org.retention");

      const page = answered.output as {
        items: { tracesByMonth: Record<string, number> }[];
        total: number;
      };
      expect(page).toMatchObject({
        items: [
          {
            projectId: ACME_PROJECT,
            tracesRetentionDays: 30,
            scenariosRetentionDays: 90,
            experimentsRetentionDays: 180,
            oldestMonthWithTraces: "2025-12",
            pendingRetentionRewrites: 1,
          },
        ],
        total: 1,
      });
      const months = Object.keys(page.items[0]?.tracesByMonth ?? {});
      expect(months).toHaveLength(12);
      expect(months[0]).toBe("2025-12");
      expect(months[11]).toBe("2026-11");
      expect(page.items[0]?.tracesByMonth["2026-11"]).toBe(42);
    });

    /** @scenario "org.retention reads only the approved organization" */
    it("refuses an organization or project field", async () => {
      const w = world();
      const call = await caller(w, { scopes: ["org:metadata"], functions: ["org.retention"] });

      await expect(codeOf(call("org.retention", { organizationId: "org_globex" }))).resolves.toBe(
        "staff_function_bad_input",
      );
      await expect(
        codeOf(call("org.retention", { projectId: "org_globex_project" })),
      ).resolves.toBe("staff_function_bad_input");
    });
  });

  describe("given a redeemed ops:read session naming evaluators.platform_usage", () => {
    /** @scenario "evaluators.platform_usage answers runs and failures per evaluator type across the platform" */
    it("answers each evaluator type's projects, runs, errors by code and skips", async () => {
      const w = world();
      const call = await opsRead(w, ["evaluators.platform_usage"]);

      const answered = await call("evaluators.platform_usage", { since: "2026-10-26T10:00:00Z" });

      expect(answered.output).toMatchObject({
        items: expect.arrayContaining([
          {
            evaluatorType: "langevals/llm_boolean",
            projects: 12,
            runs: 900,
            errors: 40,
            skipped: 5,
            errorsByCode: { provider_rate_limited: 40 },
          },
          {
            evaluatorType: "other",
            projects: 1,
            runs: 3,
            errors: 0,
            skipped: 0,
            errorsByCode: {},
          },
        ]),
        total: 2,
      });
      expect(JSON.stringify(answered.output)).not.toContain("ACME");
      expect(w.state.platform.usageAsks).toEqual([
        { since: Date.parse("2026-10-26T10:00:00Z"), until: Date.parse("2026-11-02T10:00:00Z") },
      ]);
    });

    /** @scenario "evaluators.platform_usage refuses a range over 31 days" */
    it("refuses a range of 40 days", async () => {
      const w = world();
      const call = await opsRead(w, ["evaluators.platform_usage"]);

      await expect(
        codeOf(call("evaluators.platform_usage", { since: "2026-09-23T10:00:00Z" })),
      ).resolves.toBe("staff_function_bad_input");
      expect(w.state.platform.usageAsks).toEqual([]);
    });
  });
});
