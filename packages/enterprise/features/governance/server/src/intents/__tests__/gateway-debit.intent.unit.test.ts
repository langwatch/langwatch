// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A run of the sole debit writer against a stub port, so the assertions are
 * about which BUDGET_UPDATED change events reach the feed rather than about
 * ClickHouse or Postgres.
 */
import { describe, expect, it, vi } from "vitest";
import { GatewayDebitIntent, writeGatewayDebitsSchema } from "../gateway-debit.intent";
import { GatewayDebitPort, type GatewayResolvedBudget } from "../../ports/gateway-debit.port";

function budget(onBreach: "BLOCK" | "WARN", id = `budget-${onBreach}`): GatewayResolvedBudget {
  return {
    budget: { id, scopeType: "PROJECT", window: "MONTH", onBreach },
    bucketScopeId: "project-1",
    endUserId: null,
  };
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

function harness({
  budgets,
  shouldEmit,
}: {
  budgets: GatewayResolvedBudget[];
  shouldEmit?: ReturnType<typeof vi.fn>;
}) {
  const emitBudgetUpdated = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockResolvedValue(undefined);
  const port = {
    resolve: vi.fn().mockResolvedValue(budgets),
    insert,
    detectCrossings: vi.fn().mockResolvedValue(undefined),
    shouldEmitBudgetUpdated: shouldEmit ?? vi.fn().mockResolvedValue(true),
    emitBudgetUpdated,
  } as unknown as GatewayDebitPort;

  return { intent: GatewayDebitIntent.create(port), emitBudgetUpdated, insert, shouldEmit: port.shouldEmitBudgetUpdated };
}

describe("BUDGET_UPDATED change events from the gateway debit writer", () => {
  describe("given a budget that blocks on breach", () => {
    describe("when a debit lands inside an already-claimed window", () => {
      /** @scenario "A blocking budget's spend update is never held back" */
      it("emits anyway, because an enforcement decision is never held back", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { intent, emitBudgetUpdated } = harness({
          budgets: [budget("BLOCK")],
          shouldEmit,
        });

        await intent.execute(payload());

        expect(emitBudgetUpdated).toHaveBeenCalledTimes(1);
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
        const { intent, emitBudgetUpdated } = harness({
          budgets: [budget("WARN", "b-warn"), budget("BLOCK", "b-block")],
          shouldEmit,
        });

        await intent.execute(payload());

        expect(emitBudgetUpdated).toHaveBeenCalledTimes(1);
        expect(shouldEmit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a budget that only warns on breach", () => {
    describe("when the window is already claimed", () => {
      /** @scenario "Repeat updates for a warn-only budget collapse into one" */
      it("suppresses the redundant emission", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { intent, emitBudgetUpdated, shouldEmit: shouldEmitPort } = harness({
          budgets: [budget("WARN")],
          shouldEmit,
        });

        await intent.execute(payload());

        expect(shouldEmitPort).toHaveBeenCalledWith({ projectId: "project-1" });
        expect(emitBudgetUpdated).not.toHaveBeenCalled();
      });

      /** @scenario "Repeat updates for a warn-only budget collapse into one" */
      it("still writes the debit rows, so only the invalidation is deduped", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(false);
        const { intent, insert } = harness({
          budgets: [budget("WARN")],
          shouldEmit,
        });

        await intent.execute(payload());

        expect(insert).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the window is free", () => {
      it("emits the change event naming every applicable budget", async () => {
        const shouldEmit = vi.fn().mockResolvedValue(true);
        const { intent, emitBudgetUpdated } = harness({
          budgets: [budget("WARN", "b-1"), budget("WARN", "b-2")],
          shouldEmit,
        });

        await intent.execute(payload());

        expect(emitBudgetUpdated).toHaveBeenCalledTimes(1);
        expect(emitBudgetUpdated).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            projectId: "project-1",
            budgetIds: ["b-1", "b-2"],
          }),
        );
      });
    });
  });

  describe("given a port that always says to emit", () => {
    describe("when a debit lands", () => {
      it("emits every time", async () => {
        const { intent, emitBudgetUpdated } = harness({ budgets: [budget("WARN")] });

        await intent.execute(payload());
        await intent.execute(payload());

        expect(emitBudgetUpdated).toHaveBeenCalledTimes(2);
      });
    });
  });
});
