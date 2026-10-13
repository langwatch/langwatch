/**
 * @vitest-environment node
 * The `emailSuppression.*` namespace over the real runtime: which half of it
 * opens without a session, and which half is gated on the automation
 * permissions.
 * @see specs/automations/unsubscribe-landing.feature
 */
import {
  bindTrpcMiddlewareContext,
  callerAddressContext,
  createTrpcRuntime,
} from "@langwatch/api/trpc";
import type { AutomationApi } from "@langwatch/automation-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { emailSuppressionTrpcTransport } from "../email-suppression.trpc.ts";
import type { AutomationTrpcTestContext } from "./automation.trpc.harness.ts";

function mount(
  options: { app?: Partial<AutomationApi>; permits?: (name: string) => boolean } = {},
) {
  const trpc = initTRPC.context<AutomationTrpcTestContext>().create();
  const router = createTrpcRuntime<AutomationTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    anonymousProcedure: trpc.procedure,
    members: trpcTestMembers<AutomationTrpcTestContext>({ permits: options.permits }),
  }).mount(emailSuppressionTrpcTransport, () => options.app as AutomationApi, {
    middlewareContext: [
      bindTrpcMiddlewareContext(callerAddressContext, (ctx) => ctx.address ?? null),
    ],
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

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "confirmUnsubscribe",
        "getAll",
        "getPage",
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

        await expect(anonymous.resolveUnsubscribeToken({ token: "t_valid" })).resolves.toEqual(
          view,
        );
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
  describe("given an operator who may view automations", () => {
    describe("when they read a page of the suppression list", () => {
      /** @scenario "A page is readable with the permission to view automations" */
      it("answers the page for that operator with the default page size", async () => {
        const page = { suppressions: [], nextCursor: null };
        const listSuppressionsPage = vi.fn().mockResolvedValue(page);
        const { router } = mount({
          app: { listSuppressionsPage },
          permits: (permission) => permission === "triggers:view",
        });
        const operator = router.createCaller({ actor: { id: "user-1" }, address: null });

        await expect(operator.getPage({ projectId: "project-1" })).resolves.toEqual(page);
        expect(listSuppressionsPage).toHaveBeenCalledWith({
          projectId: "project-1",
          limit: 50,
          actorId: "user-1",
        });
      });

      it("hands the continuation back as a date and an id", async () => {
        const listSuppressionsPage = vi
          .fn()
          .mockResolvedValue({ suppressions: [], nextCursor: null });
        const { operator } = mount({ app: { listSuppressionsPage } });

        await operator.getPage({
          projectId: "project-1",
          limit: 10,
          cursor: { createdAt: new Date("2026-10-01T10:00:00.000Z"), id: "s4" },
        });

        expect(listSuppressionsPage).toHaveBeenCalledWith({
          projectId: "project-1",
          limit: 10,
          cursor: { createdAt: new Date("2026-10-01T10:00:00.000Z"), id: "s4" },
          actorId: "user-1",
        });
      });
    });
  });

  describe("given an operator who may not view automations", () => {
    describe("when they read a page", () => {
      /** @scenario "A page is refused without the permission to view automations" */
      it("refuses them before the app is asked", async () => {
        const listSuppressionsPage = vi.fn();
        const { router } = mount({ app: { listSuppressionsPage }, permits: () => false });
        const operator = router.createCaller({ actor: { id: "user-1" }, address: null });

        await expect(operator.getPage({ projectId: "project-1" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(listSuppressionsPage).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a continuation with no id, or a page size outside the allowed range", () => {
    describe("when the page is read", () => {
      /** @scenario "A malformed continuation or page size is refused before any read" */
      it("refuses the request as malformed and reads nothing", async () => {
        const listSuppressionsPage = vi.fn();
        const { operator } = mount({ app: { listSuppressionsPage } });

        await expect(
          operator.getPage({
            projectId: "project-1",
            cursor: { createdAt: new Date("2026-10-01T10:00:00.000Z"), id: "" },
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(operator.getPage({ projectId: "project-1", limit: 0 })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
        await expect(
          operator.getPage({ projectId: "project-1", limit: 101 }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(listSuppressionsPage).not.toHaveBeenCalled();
      });
    });
  });
});
