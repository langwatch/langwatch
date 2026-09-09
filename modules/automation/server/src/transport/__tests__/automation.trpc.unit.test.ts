/**
 * @vitest-environment node
 * The `automation.*` namespace over the real runtime: the wire names the
 * browser calls, the kind each one is, the permission it is answered behind,
 * and the caller each write is attributed to.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { AutomationApi } from "@langwatch/automation-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { automationCallerEmailFact, automationTrpcTransport } from "../automation.trpc.ts";
import {
  automationTrpcTestPorts,
  type AutomationTrpcTestContext,
} from "./automation.trpc.harness.ts";

function mount(options: { app?: Partial<AutomationApi>; permits?: (name: string) => boolean } = {}) {
  const trpc = initTRPC.context<AutomationTrpcTestContext>().create();
  const router = createTrpcRuntime<AutomationTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: automationTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(automationTrpcTransport, () => options.app as AutomationApi, {
    facts: [bindTrpcFact(automationCallerEmailFact, (ctx) => ctx.email ?? null)],
  });

  return {
    router,
    caller: router.createCaller({ actor: { id: "user-1" }, email: "user@example.com" }),
  };
}

describe("the automation tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the browser calls", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "create",
        "deleteById",
        "getDailyCap",
        "getDailyCapStatus",
        "getRecentActivity",
        "getRecentFires",
        "getReportSchedules",
        "getTriggerById",
        "getTriggerStats",
        "getTriggers",
        "getWebhookDeliveries",
        "listSlackChannels",
        "testFireTemplate",
        "toggleTrigger",
        "updateTriggerFilters",
        "upsert",
      ]);
    });

    it("reads with a query and changes with a mutation", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        create: "mutation",
        deleteById: "mutation",
        getDailyCap: "query",
        getDailyCapStatus: "query",
        getRecentActivity: "query",
        getRecentFires: "query",
        getReportSchedules: "query",
        getTriggerById: "query",
        getTriggerStats: "query",
        getTriggers: "query",
        getWebhookDeliveries: "query",
        listSlackChannels: "mutation",
        testFireTemplate: "mutation",
        toggleTrigger: "mutation",
        updateTriggerFilters: "mutation",
        upsert: "mutation",
      });
    });
  });

  describe("given a caller who may view automations but not change them", () => {
    describe("when a write is called", () => {
      it("refuses the write and still answers the read", async () => {
        const { caller } = mount({
          app: { getFireStats: async () => [] },
          permits: (permission) => permission === "triggers:view",
        });

        await expect(caller.getTriggerStats({ projectId: "project-1" })).resolves.toEqual([]);
        await expect(
          caller.deleteById({ projectId: "project-1", triggerId: "trigger-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  describe("given the signed-in author", () => {
    describe("when a test fire is asked for", () => {
      it("delivers it to the address the process resolved, never one the client sent", async () => {
        const sendTestFire = vi.fn().mockResolvedValue({ channel: "email", didSend: true });
        const { caller } = mount({ app: { sendTestFire } });

        await caller.testFireTemplate({
          projectId: "project-1",
          channel: "email",
          trigger: { name: "Nightly", alertType: null },
          draft: {},
        } as never);

        expect(sendTestFire).toHaveBeenCalledWith(expect.anything(), {
          id: "user-1",
          email: "user@example.com",
        });
      });
    });

    describe("when an automation is saved", () => {
      it("attributes the write to the caller the door resolved", async () => {
        const saveAutomation = vi.fn().mockResolvedValue({ id: "trigger-1" });
        const { caller } = mount({ app: { saveAutomation } });

        await caller
          .upsert({
            projectId: "project-1",
            name: "Nightly",
            action: "SEND_EMAIL",
            filters: {},
            actionParams: {},
            templates: {},
          } as never)
          .catch(() => undefined);

        expect(saveAutomation).toHaveBeenCalledWith(expect.anything(), { id: "user-1" });
      });
    });
  });
});
