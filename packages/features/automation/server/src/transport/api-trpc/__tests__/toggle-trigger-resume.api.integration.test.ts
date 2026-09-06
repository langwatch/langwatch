/**
 * @vitest-environment node
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationApp } from "../../../app/automation.app.ts";
import { AutomationTrpcApi, type AutomationTrpcContext } from "../automation.api.ts";

function harness(update: (input: Record<string, unknown>) => Promise<unknown>) {
  const trpc = initTRPC.context<AutomationTrpcContext>().create();
  const app = {
    requireById: async () => ({
      id: "trigger-1",
      triggerKind: "TRIGGER",
      actionParams: {},
    }),
    update,
  } as unknown as AutomationApp;

  const router = AutomationTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
      validateOutput: true,
    },
    {
      rateLimit: async () => ({ allowed: true, resetAt: 0 }),
      providers: {
        redactActionParamsFor: (_action: unknown, params: unknown) => params,
      } as never,
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

describe("automation.toggleTrigger", () => {
  describe("given a trigger paused for runaway volume", () => {
    describe("when the customer re-enables it", () => {
      /** @scenario "Resuming a paused automation clears the pause reason" */
      it("clears the pause reason and pause time in the same write", async () => {
        const update = vi.fn().mockResolvedValue({
          id: "trigger-1",
          projectId: "project-1",
          name: "Nightly digest",
          action: "SEND_EMAIL",
          triggerKind: "AUTOMATION",
          actionParams: {},
          filters: {},
          filterQuery: null,
          active: true,
          deleted: false,
          pausedReason: null,
          pausedAt: null,
          message: null,
          alertType: null,
          customGraphId: null,
          notificationCadence: "immediate",
          traceDebounceMs: 0,
          templates: {
            slackTemplateType: null,
            slackTemplate: null,
            emailSubjectTemplate: null,
            emailBodyTemplate: null,
          },
          createdAt: new Date(0),
          updatedAt: new Date(0),
          lastRunAt: null,
        });

        await harness(update).toggleTrigger({
          projectId: "project-1",
          triggerId: "trigger-1",
          active: true,
        });

        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({ active: true, pausedReason: null, pausedAt: null }),
        );
      });
    });
  });
});
