/**
 * @vitest-environment node
 *
 * `getDailyCapStatus` reads its own trigger ids from the project rather than
 * taking them from the caller, so the list's skipped-today badge covers every
 * automation the project owns, not just whatever page size a caller passed.
 *
 * Covers @integration scenarios from
 * specs/automations/runaway-automation-containment.feature.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { AutomationApp } from "../../../app/automation.app";
import { AutomationTrpcApi, type AutomationTrpcContext } from "../automation.api";

function harness(triggerIds: string[], skipped: Record<string, number>) {
  const trpc = initTRPC.context<AutomationTrpcContext>().create();
  const app = {
    resolvePersistDailyCap: async () => 100,
    getAllForProject: async () => triggerIds.map((id) => ({ id })),
    readPersistCapCounts: async (input: { triggerIds: string[] }) =>
      Object.fromEntries(
        input.triggerIds.map((id) => [id, { count: skipped[id] ?? 0, skipped: skipped[id] ?? 0 }]),
      ),
  } as unknown as AutomationApp;

  const router = AutomationTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
    },
    {
      rateLimit: async () => ({ allowed: true, resetAt: 0 }),
      providers: {} as never,
      listSlackChannels: async () => ({ channels: [] }) as never,
      assertTraceFilterQueryCompiles: () => undefined,
    },
  );

  return router.createCaller({
    app: { automation: app },
    actor: () => ({ id: "user-1" }),
    session: { user: { email: "user@example.com" } },
  });
}

describe("automation.getDailyCapStatus", () => {
  describe("given a project with more automations than one request used to carry", () => {
    describe("when the automations list reads the daily cap status", () => {
      /** @scenario "Every automation on the list reports what it skipped" */
      it("still reports the later automation's skipped count", async () => {
        const ids = Array.from({ length: 60 }, (_, i) => `trigger-${i}`);
        const result = await harness(ids, { "trigger-59": 12 }).getDailyCapStatus({
          projectId: "project-1",
        });

        expect(Object.keys(result.counts)).toHaveLength(60);
        expect(result.counts["trigger-59"]).toMatchObject({ skipped: 12 });
      });
    });
  });

  describe("given a trigger that skipped matches today", () => {
    describe("when the customer opens the automations list", () => {
      /** @scenario "The automations list shows what was skipped today" */
      it("shows how many matches the trigger skipped today", async () => {
        const result = await harness(["trigger-1"], { "trigger-1": 4 }).getDailyCapStatus({
          projectId: "project-1",
        });

        expect(result.counts["trigger-1"]).toMatchObject({ skipped: 4 });
      });
    });
  });
});
