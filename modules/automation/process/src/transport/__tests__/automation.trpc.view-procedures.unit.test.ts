import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import {
  TriggerNotFoundError,
  type AutomationApi,
  type TriggerLatestEvaluation,
} from "@langwatch/automation-contract";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * The automation view's reads over the real runtime: the fire-history page,
 * the latest evaluation (recorded through the real service over its memory
 * twin), and when the automation acts next. Each is gated by `triggers:view`.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { MemoryTriggerLatestEvaluationRepository } from "../../repositories/memory/memory.trigger-latest-evaluation.repository.ts";
import { TriggerLatestEvaluationService } from "../../services/trigger-latest-evaluation.service.ts";
import { automationCallerEmailFact, automationTrpcTransport } from "../automation.trpc.ts";
import type { AutomationTrpcTestContext } from "./automation.trpc.harness.ts";

const SCOPE = { projectId: "project_1", triggerId: "trigger_1" };

function mount({
  app,
  permits = () => true,
}: {
  app: Partial<AutomationApi>;
  permits?: (permission: string) => boolean;
}) {
  const trpc = initTRPC.context<AutomationTrpcTestContext>().create();
  const router = createTrpcRuntime<AutomationTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<AutomationTrpcTestContext>({ permits }),
  }).mount(automationTrpcTransport, () => createApiFixture<AutomationApi>(app), {
    facts: [bindTrpcFact(automationCallerEmailFact, () => null)],
  });
  return router.createCaller({ actor: { id: "user_1" } });
}

function evaluation(overrides: Partial<TriggerLatestEvaluation> = {}): TriggerLatestEvaluation {
  return {
    ...SCOPE,
    evaluatedAt: new Date("2026-08-12T12:00:00.000Z"),
    verdict: "not_breached",
    observedValue: 42,
    threshold: 100,
    operator: "gt",
    timePeriodMinutes: 60,
    skipCode: null,
    ...overrides,
  };
}

function evaluationRig() {
  const { logger, lines } = createTestLogger();
  const repository = MemoryTriggerLatestEvaluationRepository.create();
  const service = TriggerLatestEvaluationService.create({ repository, logger });
  const caller = mount({
    app: { findLatestEvaluation: (input) => service.findByTriggerId(input) },
  });
  return { caller, service, repository, lines };
}

describe("the automation view's reads", () => {
  describe("given the fire-history read", () => {
    describe("when the view asks without a limit or cursor", () => {
      it("asks for main's default page of 20 from the newest fire", async () => {
        const listFireHistoryPage = vi.fn(async () => ({ fires: [], nextCursor: null }));
        const caller = mount({ app: { listFireHistoryPage } });

        await caller.getFireHistory(SCOPE);

        expect(listFireHistoryPage).toHaveBeenCalledWith({ ...SCOPE, limit: 20, cursor: null });
      });
    });

    describe("when the view passes the cursor it was handed", () => {
      it("resumes from that fire", async () => {
        const listFireHistoryPage = vi.fn(async () => ({ fires: [], nextCursor: null }));
        const caller = mount({ app: { listFireHistoryPage } });
        const cursor = { createdAt: new Date("2026-08-12T11:00:00.000Z"), id: "fire_9" };

        await caller.getFireHistory({ ...SCOPE, limit: 5, cursor });

        expect(listFireHistoryPage).toHaveBeenCalledWith({ ...SCOPE, limit: 5, cursor });
      });
    });

    describe("when the view asks for more than a page holds", () => {
      it("refuses the input", async () => {
        const caller = mount({ app: {} });

        await expect(caller.getFireHistory({ ...SCOPE, limit: 51 })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      });
    });

    describe("when the caller cannot view automations", () => {
      it("is refused", async () => {
        const caller = mount({ app: {}, permits: () => false });

        await expect(caller.getFireHistory(SCOPE)).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  describe("given the latest-evaluation read", () => {
    describe("when the alert has been evaluated", () => {
      /** @scenario "The view shows the last evaluation with observed value vs threshold" */
      it("returns what the check observed and decided", async () => {
        const { caller, service } = evaluationRig();
        await service.record(evaluation());

        await expect(caller.getLatestEvaluation(SCOPE)).resolves.toEqual(evaluation());
      });
    });

    describe("when the alert crossed its threshold", () => {
      /** @scenario "An automation that crossed its threshold reads as fired" */
      it("reads as fired, the later check replacing the earlier one", async () => {
        const { caller, service } = evaluationRig();
        await service.record(evaluation());
        await service.record(evaluation({ verdict: "fired", observedValue: 250 }));

        await expect(caller.getLatestEvaluation(SCOPE)).resolves.toMatchObject({
          verdict: "fired",
          observedValue: 250,
        });
      });
    });

    describe("when the check was skipped", () => {
      /** @scenario "A skipped evaluation names its reason" */
      it("carries the stable skip code", async () => {
        const { caller, service } = evaluationRig();
        await service.record(
          evaluation({ verdict: "skipped", observedValue: null, skipCode: "result_too_large" }),
        );

        await expect(caller.getLatestEvaluation(SCOPE)).resolves.toMatchObject({
          verdict: "skipped",
          skipCode: "result_too_large",
        });
      });
    });

    describe("when the alert has never been evaluated", () => {
      /** @scenario "An automation that has never been evaluated says so" */
      it("returns nothing rather than an invented record", async () => {
        const { caller } = evaluationRig();

        await expect(caller.getLatestEvaluation(SCOPE)).resolves.toBeNull();
      });
    });

    describe("when another project's row holds the trigger id", () => {
      it("neither overwrites it nor reads it back, and says so in the log", async () => {
        const { caller, service, lines } = evaluationRig();
        await service.record(evaluation({ projectId: "project_other" }));
        await service.record(evaluation());

        await expect(caller.getLatestEvaluation(SCOPE)).resolves.toBeNull();
        expect(lines.findLine("warn", "affected no rows")).toBeDefined();
      });
    });

    describe("when recording fails", () => {
      /** @scenario "A failure to record an evaluation never fails the automation" */
      it("logs the failure and does not throw", async () => {
        const { service, repository, lines } = evaluationRig();
        vi.spyOn(repository, "upsert").mockRejectedValue(new Error("table unreachable"));

        await expect(service.record(evaluation())).resolves.toBeUndefined();
        expect(lines.findLine("warn", "failed to record")).toBeDefined();
      });
    });
  });

  describe("given the next-firing read", () => {
    describe("when the automation is a report", () => {
      /** @scenario "The view shows the next scheduled firing" */
      it("answers the operation's next firing", async () => {
        const nextRunAt = new Date("2026-08-13T09:00:00.000Z");
        const getNextFiring = vi.fn(async () => ({ kind: "schedule" as const, nextRunAt }));
        const caller = mount({ app: { getNextFiring } });

        await expect(caller.getNextFiring(SCOPE)).resolves.toEqual({
          kind: "schedule",
          nextRunAt,
        });
        expect(getNextFiring).toHaveBeenCalledWith(SCOPE);
      });
    });

    describe("when the automation does not exist in this project", () => {
      it("reports it as not found", async () => {
        const caller = mount({
          app: { getNextFiring: async () => Promise.reject(new TriggerNotFoundError()) },
        });

        await expect(caller.getNextFiring(SCOPE)).rejects.toMatchObject({
          cause: { code: "trigger_not_found" },
        });
      });
    });

    describe("when the caller cannot view automations", () => {
      it("is refused", async () => {
        const caller = mount({ app: {}, permits: () => false });

        await expect(caller.getNextFiring(SCOPE)).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });
});
