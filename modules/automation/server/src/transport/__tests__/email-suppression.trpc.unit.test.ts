/**
 * @vitest-environment node
 * The `emailSuppression.*` namespace over the real runtime: which half of it
 * opens without a session, and which half is gated on the automation
 * permissions.
 * @see specs/automations/unsubscribe-landing.feature
 */
import { bindTrpcFact, callerAddressFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { AutomationApi } from "@langwatch/automation-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { emailSuppressionTrpcTransport } from "../email-suppression.trpc.ts";
import {
  automationTrpcTestPorts,
  type AutomationTrpcTestContext,
} from "./automation.trpc.harness.ts";

function mount(options: { app?: Partial<AutomationApi>; permits?: (name: string) => boolean } = {}) {
  const trpc = initTRPC.context<AutomationTrpcTestContext>().create();
  const router = createTrpcRuntime<AutomationTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    anonymousProcedure: trpc.procedure,
    ports: automationTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(emailSuppressionTrpcTransport, () => options.app as AutomationApi, {
    facts: [bindTrpcFact(callerAddressFact, (ctx) => ctx.address ?? null)],
  });

  return {
    router,
    /** A mail client: no session at all. */
    anonymous: router.createCaller({ actor: null, address: "10.0.0.1" }),
    operator: router.createCaller({ actor: { id: "user-1" }, address: "10.0.0.1" }),
  };
}

describe("the email suppression tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the unsubscribe page and the settings page call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "confirmUnsubscribe",
        "getAll",
        "remove",
        "resolveUnsubscribeToken",
      ]);
    });
  });

  describe("given a mail client with no session", () => {
    describe("when it resolves the token in the link it was sent", () => {
      it("answers the masked view without a caller", async () => {
        const view = { projectName: "Acme", triggerName: "Nightly", email: "a***@acme.test" };
        const { anonymous } = mount({ app: { resolveUnsubscribeView: async () => view } });

        await expect(anonymous.resolveUnsubscribeToken({ token: "t_valid" })).resolves.toEqual(view);
      });
    });

    describe("when it confirms the unsubscribe", () => {
      it("passes the caller address the process resolved, so the throttle can key on it", async () => {
        const acceptUnsubscribe = vi.fn().mockResolvedValue(undefined);
        const { anonymous } = mount({ app: { acceptUnsubscribe } });

        await expect(
          anonymous.confirmUnsubscribe({ token: "t_valid", scope: "trigger" }),
        ).resolves.toEqual({ ok: true });
        expect(acceptUnsubscribe).toHaveBeenCalledWith({
          token: "t_valid",
          scope: "trigger",
          callerAddress: "10.0.0.1",
          via: "link",
        });
      });
    });
  });

  describe("given an operator who may view automations but not manage them", () => {
    describe("when the suppression list is read and a row removed", () => {
      it("answers the list against the caller and refuses the removal", async () => {
        const listSuppressions = vi.fn().mockResolvedValue([]);
        const { router } = mount({
          app: { listSuppressions },
          permits: (permission) => permission === "triggers:view",
        });
        const operator = router.createCaller({ actor: { id: "user-1" }, address: null });

        await expect(operator.getAll({ projectId: "project-1" })).resolves.toEqual([]);
        expect(listSuppressions).toHaveBeenCalledWith({
          projectId: "project-1",
          actorId: "user-1",
        });
        await expect(
          operator.remove({ projectId: "project-1", id: "suppression-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });
});
