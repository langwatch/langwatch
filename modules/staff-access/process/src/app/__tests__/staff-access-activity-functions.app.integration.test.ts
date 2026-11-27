/**
 * The activity ops functions end to end through the module: request, passkey approval, redeem,
 * call. Peers are stand-ins (support/); the trail runs on the memory twins, since these reads
 * write nothing beyond what the core suite already proves on Postgres.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import {
  ACME,
  GLOBEX,
  INITECH,
  requestBody,
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
  return (name: string, input: unknown) => w.app.callFunction({ session, name, input });
}

const metadata = (w: World, functions: string[]) =>
  caller(w, { scopes: ["org:metadata"], functions });

describe("the activity ops functions", () => {
  describe("given a redeemed org:metadata session on ACME", () => {
    /** @scenario "org.coding_agents answers sessions per day, project and agent" */
    it("answers coding agent sessions per day, project and agent, odd kinds as other", async () => {
      const w = world();
      const call = await metadata(w, ["org.coding_agents"]);

      const answered = await call("org.coding_agents", { since: "2026-10-26T10:00:00Z" });

      expect(answered).toEqual({
        name: "org.coding_agents",
        rows: 2,
        output: {
          items: [
            {
              day: "2026-11-01T00:00:00.000Z",
              projectId: ACME_PROJECT,
              agent: "claude_code",
              sessions: 3,
              users: 2,
            },
            {
              day: "2026-11-01T00:00:00.000Z",
              projectId: ACME_PROJECT,
              agent: "other",
              sessions: 1,
              users: 1,
            },
          ],
          total: 2,
          truncated: false,
          nextCursor: null,
        },
      });
    });

    /** @scenario "org.coding_agents reads only the approved organization's projects" */
    it("asks the coding agent module for ACME's projects only", async () => {
      const w = world();
      const call = await metadata(w, ["org.coding_agents"]);

      await call("org.coding_agents", { since: "2026-10-26T10:00:00Z" });

      expect(w.state.activityAsks).toEqual([{ read: "coding_agents", projectIds: [ACME_PROJECT] }]);
    });

    /** @scenario "org.gateway_spend answers requests and spend per day, virtual key and provider" */
    it("answers gateway requests and spend per day, virtual key and provider", async () => {
      const w = world();
      const call = await metadata(w, ["org.gateway_spend"]);

      const answered = await call("org.gateway_spend", { since: "2026-10-26T10:00:00Z" });

      expect(answered.output).toEqual({
        items: [
          {
            day: "2026-11-01T00:00:00.000Z",
            projectId: ACME_PROJECT,
            virtualKeyId: "vk_1",
            providerId: "provider_1",
            requests: 10,
            failedRequests: 1,
            spendUsd: 0.25,
          },
        ],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
    });

    /** @scenario "org.instant_evals answers runs per week with rows judged, failures by code and price" */
    it("folds Instant Eval days into their week, failures by plain code", async () => {
      const w = world();
      const call = await metadata(w, ["org.instant_evals"]);

      const answered = await call("org.instant_evals", { since: "2026-10-19T10:00:00Z" });
      const output = answered.output as { items: Record<string, unknown>[]; total: number };

      expect(output.total).toBe(1);
      expect(output.items[0]).toEqual({
        week: "2026-10-26T00:00:00.000Z",
        projectId: ACME_PROJECT,
        runs: 3,
        judgedRows: 1400,
        largestRun: 800,
        failedRuns: 2,
        failedByCode: { instant_eval_budget_exhausted: 1, other: 1 },
        priceUsd: expect.closeTo(0.3, 6),
        lastRunAt: "2026-10-29T02:00:00.000Z",
      });
    });

    /** @scenario "org.activity_weekly answers one row per week" */
    it("answers one row per week, oldest first, with every count", async () => {
      const w = world();
      const call = await metadata(w, ["org.activity_weekly"]);

      const answered = await call("org.activity_weekly", { weeks: 4 });
      const output = answered.output as { items: Record<string, unknown>[] };

      const quiet = { instantEvalRuns: 0, codingAgentSessions: 0, gatewayRequests: 0 };
      const every = {
        traces: 42,
        evaluations: 10,
        scenarioRuns: 5,
        membersActiveSinceWeekStart: 1,
      };
      expect(output.items).toEqual([
        { week: "2026-10-12T00:00:00.000Z", ...every, ...quiet },
        { week: "2026-10-19T00:00:00.000Z", ...every, ...quiet },
        {
          week: "2026-10-26T00:00:00.000Z",
          ...every,
          instantEvalRuns: 3,
          codingAgentSessions: 4,
          gatewayRequests: 10,
        },
        { week: "2026-11-02T00:00:00.000Z", ...every, ...quiet },
      ]);
    });

    /** @scenario "org.activity_weekly reads at most 26 weeks" */
    it("refuses more than 26 weeks or none", async () => {
      const w = world();
      const call = await metadata(w, ["org.activity_weekly"]);

      await expect(codeOf(call("org.activity_weekly", { weeks: 27 }))).resolves.toBe(
        "staff_function_bad_input",
      );
      await expect(codeOf(call("org.activity_weekly", { weeks: 0 }))).resolves.toBe(
        "staff_function_bad_input",
      );
    });

    /** @scenario "An activity range is at most 31 days" */
    it("refuses a range of 40 days", async () => {
      const w = world();
      const call = await metadata(w, ["org.gateway_spend"]);

      await expect(
        codeOf(
          call("org.gateway_spend", {
            since: "2026-09-23T10:00:00Z",
            until: "2026-11-02T10:00:00Z",
          }),
        ),
      ).resolves.toBe("staff_function_bad_input");
    });
  });

  describe("given an ops:read session", () => {
    /** @scenario "scenarios.runs_by_org answers organizations that ran scenarios, by id and plan" */
    it("answers ACME by id and plan and leaves out an organization that ran none", async () => {
      const w = world();
      const call = await caller(w, { scopes: ["ops:read"], functions: ["scenarios.runs_by_org"] });

      const answered = await call("scenarios.runs_by_org", { since: "2026-10-26T10:00:00Z" });

      expect(answered.output).toEqual({
        items: [
          {
            organizationId: ACME.id,
            plan: "growth",
            projects: 1,
            suites: 2,
            runs: 5,
            failedRuns: 1,
          },
        ],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
      expect(w.state.activityAsks.map((ask) => ask.projectIds)).toEqual([
        [ACME_PROJECT],
        [`${GLOBEX.id}_project`],
        [`${INITECH.id}_project`],
      ]);
      expect(JSON.stringify(answered.output)).not.toContain(ACME.name);
    });

    /** @scenario "scenarios.runs_by_org needs an ops:read session" */
    it("refuses scenarios.runs_by_org on an org:metadata request", async () => {
      const w = world();
      const agent = await w.enrol();

      await expect(
        codeOf(
          w.app.createRequest({
            session: agent.session,
            body: requestBody({ scopes: ["org:metadata"], functions: ["scenarios.runs_by_org"] }),
          }),
        ),
      ).resolves.toBe("staff_function_scope_mismatch");
    });
  });
});
