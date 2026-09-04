/**
 * @vitest-environment node
 *
 * Resuming a paused automation must clear the platform's own pause record in
 * the same write, or a running automation keeps claiming it was paused for
 * runaway volume.
 *
 * Covers @integration scenarios from
 * specs/automations/runaway-automation-containment.feature.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { AutomationApp } from "../../../app/automation.app";
import { AutomationTrpcApi, type AutomationTrpcContext } from "../automation.api";

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
        const update = vi.fn().mockResolvedValue({ id: "trigger-1", active: true });

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
