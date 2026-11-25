/**
 * @vitest-environment node
 * The judge's own side of the catch-ups: its spend holds a request once however the ledger copy
 * and the priced fact race, and it places a project its owners hold with no catch-up (ADR-174
 * decision 17, R40). Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { INSTANT_EVAL_SPEND_MODEL } from "@langwatch/instant-eval-judge-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instantEvalJudgeOverMemory } from "../../__tests__/support/instant-eval-judge-over-memory.test-fakes.ts";

const ORGANIZATION = "org-acme";
const OCCURRED_AT = Date.UTC(2026, 9, 6);
const CENTS = 10_000_000;

function judgeOnEventing() {
  const judge = instantEvalJudgeOverMemory();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  eventing.register(judge.factsPipeline());
  const spend = eventing.register(judge.spendPipeline());
  judge.connectSpend((fact) => spend.commands.recordSpendPriced.send(fact));
  return { judge, eventing, spend };
}

describe("the judge beside the spend and project catch-ups", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given the ledger copy of a request the judge already holds", () => {
    describe("when the same request is copied again", () => {
      it("answers already_held and keeps one row for the request", async () => {
        const { judge, eventing } = judgeOnEventing();
        close = () => eventing.close();
        const copy = {
          organizationId: ORGANIZATION,
          requestId: "instanteval_run-1",
          spendNanoUsd: 15 * CENTS,
          occurredAt: OCCURRED_AT,
        };

        await expect(judge.judges.copyLedgerSpend(copy)).resolves.toEqual({ outcome: "copied" });
        await expect(judge.judges.copyLedgerSpend(copy)).resolves.toEqual({
          outcome: "already_held",
        });

        expect(judge.rows.spend.size).toBe(1);
        expect(await judge.spendNanoUsdOf({ organizationId: ORGANIZATION })).toBe(
          BigInt(15 * CENTS),
        );
      });
    });
  });

  describe("given the gateway ledger holds a $0.10 Instant Evals request", () => {
    /** @scenario "A request in both the ledger and the judge is counted once" */
    it.each([{ when: "before" }, { when: "after" }])(
      "counts it once when the judge's priced event is folded $when the ledger copy",
      async ({ when }) => {
        const requestId = "instanteval_run-both";
        const { judge, eventing, spend } = judgeOnEventing();
        close = () => eventing.close();
        const foldPriced = async () => {
          await spend.commands.recordSpendPriced.send({
            tenantId: ORGANIZATION,
            occurredAt: OCCURRED_AT,
            organizationId: ORGANIZATION,
            projectId: "project-1",
            requestId,
            model: INSTANT_EVAL_SPEND_MODEL,
            rateVersion: "instant_eval@0.042x1.3",
            inputTokens: 1_000,
            priceNanoUsd: 10 * CENTS,
            costNanoUsd: 7_692_308,
          });
          await vi.waitFor(() => expect(judge.rows.spend.size).toBe(1));
        };

        if (when === "before") await foldPriced();
        await judge.judges.copyLedgerSpend({
          organizationId: ORGANIZATION,
          requestId,
          spendNanoUsd: 10 * CENTS,
          occurredAt: OCCURRED_AT,
        });
        if (when === "after") await foldPriced();

        expect(await judge.spendNanoUsdOf({ organizationId: ORGANIZATION })).toBe(
          BigInt(10 * CENTS),
        );
        expect(judge.rows.spend.size).toBe(1);
      },
    );
  });

  describe("given a project created before the judge was deployed, held by its owners", () => {
    describe("when the first judge call arrives for it", () => {
      /** @scenario "A project created before the deploy judges on the first call, with no catch-up" */
      it("classifies it and charges its spend to the project's organization", async () => {
        const judge = instantEvalJudgeOverMemory({
          placed: [{ projectId: "project-old-1", organizationId: ORGANIZATION }],
        });
        const eventing = new EventSourcing({
          eventStore: EventStoreMemory.createForTesting(),
          processStore: InMemoryProcessStore.createForTesting(),
        });
        close = () => eventing.close();
        const spend = eventing.register(judge.spendPipeline());
        judge.connectSpend((fact) => spend.commands.recordSpendPriced.send(fact));

        const answer = await judge.judges.judge({
          projectId: "project-old-1",
          text: "Thanks so much for your help!",
          questions: [{ id: "polite", kind: "boolean", instructions: "Is it polite?" }],
        });

        expect(answer).toMatchObject({
          outcome: "judged",
          judgement: { verdicts: [{ questionId: "polite", probability: 1 }] },
        });
        await vi.waitFor(async () =>
          expect(await judge.spendNanoUsdOf({ organizationId: ORGANIZATION })).toBeGreaterThan(0n),
        );
      });
    });
  });
});
