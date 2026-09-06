// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedBudget } from "~/server/gateway/budgetResolution.service";
import {
  runWriteGatewayDebits,
  writeGatewayDebitsSchema,
} from "../process-manager/gatewayDebits.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const resolveApplicableBudgets = vi.hoisted(() => vi.fn());
vi.mock(
  "~/server/gateway/budgetResolution.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/server/gateway/budgetResolution.service")
    >()),
    resolveApplicableBudgets,
  }),
);

// Crossing detection is its own suite and its own best-effort seam; it has
// no bearing on whether the invalidation is emitted.
vi.mock("../services/governanceSignals.service", () => ({
  detectBudgetCrossings: vi.fn().mockResolvedValue(undefined),
}));

function budget(onBreach: "BLOCK" | "WARN", id = `budget-${onBreach}`) {
  return {
    budget: {
      id,
      scopeType: "PROJECT",
      scopeId: "project-1",
      window: "MONTH",
      onBreach,
      providerKey: null,
    },
    bucketScopeId: "project-1",
    principalUserId: null,
    groupId: null,
    endUserId: null,
  } as unknown as ResolvedBudget;
}

const payload = () =>
  writeGatewayDebitsSchema.parse({
    gateway_request_id: "req-1",
    project_id: "project-1",
    organization_id: "org-1",
    team_id: "team-1",
    virtual_key_id: "vk-1",
    principal_user_id: "usr-1",
    end_user_id: "",
    model: "gpt-x",
    model_provider_id: "mp-1",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
      cache_creation_1h_tokens: 0,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      input_chars: 0,
      audio_ms: 0,
    },
    cost_nano_usd: 3_500,
    rate_version: "catalog@2026-07-30",
    status: "confirmed",
    duration_ms: 120,
    occurred_at: 1_753_800_000_000,
  });

/**
 * A run of the sole debit writer against stub stores, so the assertions are
 * about which change events reach the feed rather than about ClickHouse.
 */
function harness({
  budgets,
  shouldEmit,
}: {
  budgets: ResolvedBudget[];
  shouldEmit?: ReturnType<typeof vi.fn>;
}) {
  resolveApplicableBudgets.mockResolvedValue(budgets);

  const create = vi.fn().mockResolvedValue({ revision: 1n });
  const insertDebitsForBudgets = vi.fn().mockResolvedValue(undefined);
  const deps = {
    prisma: { gatewayChangeEvent: { create } },
    budgetCHRepository: { insertDebitsForBudgets },
    ...(shouldEmit ? { changeEventDedupe: { shouldEmit } } : {}),
  } as never;

  return { run: runWriteGatewayDebits(deps), create, insertDebitsForBudgets };
}

describe("BUDGET_UPDATED change events from the gateway debit writer", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a budget that blocks on breach", () => {
    describe("when a debit lands inside an already-claimed window", () => {
      /** @scenario "A blocking budget's spend update is never held back" */
      it("emits anyway, because an enforcement decision is never held back", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { run, create } = harness({
          budgets: [budget("BLOCK")],
          shouldEmit,
        });

        await run(payload());

        expect(create).toHaveBeenCalledTimes(1);
        // Not even asked: the dedupe is not on the blocking path at all, so
        // its window can never become the dominant term in how fast a block
        // decision propagates.
        expect(shouldEmit).not.toHaveBeenCalled();
      });
    });

    describe("when one blocking budget sits among warn-only ones", () => {
      /** @scenario "A blocking budget's spend update is never held back" */
      it("emits for the whole set", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { run, create } = harness({
          budgets: [budget("WARN", "b-warn"), budget("BLOCK", "b-block")],
          shouldEmit,
        });

        await run(payload());

        expect(create).toHaveBeenCalledTimes(1);
        expect(shouldEmit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a budget that only warns on breach", () => {
    describe("when the window is already claimed", () => {
      /** @scenario "Repeat updates for a warn-only budget collapse into one" */
      it("suppresses the redundant emission", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { run, create } = harness({
          budgets: [budget("WARN")],
          shouldEmit,
        });

        await run(payload());

        expect(shouldEmit).toHaveBeenCalledWith({ projectId: "project-1" });
        expect(create).not.toHaveBeenCalled();
      });

      /** @scenario "Repeat updates for a warn-only budget collapse into one" */
      it("still writes the debit rows, so only the invalidation is deduped", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { run, insertDebitsForBudgets } = harness({
          budgets: [budget("WARN")],
          shouldEmit,
        });

        await run(payload());

        expect(insertDebitsForBudgets).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the window is free", () => {
      it("emits the change event naming every applicable budget", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(true);
        const { run, create } = harness({
          budgets: [budget("WARN", "b-1"), budget("WARN", "b-2")],
          shouldEmit,
        });

        await run(payload());

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]?.data).toMatchObject({
          organizationId: "org-1",
          projectId: "project-1",
          kind: "BUDGET_UPDATED",
        });
        expect(create.mock.calls[0]?.[0]?.data?.payload).toMatchObject({
          budgetIds: ["b-1", "b-2"],
        });
      });
    });
  });

  describe("given no dedupe service is wired", () => {
    describe("when a debit lands", () => {
      it("emits every time, as it did before the dedupe existed", async () => {
        const { run, create } = harness({ budgets: [budget("WARN")] });

        await run(payload());
        await run(payload());

        expect(create).toHaveBeenCalledTimes(2);
      });
    });
  });
});
