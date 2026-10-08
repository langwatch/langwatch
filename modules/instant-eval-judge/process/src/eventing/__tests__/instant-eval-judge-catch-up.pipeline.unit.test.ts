/**
 * @vitest-environment node
 * The judge's own side of the catch-ups: its spend holds a request once however the ledger copy
 * and the priced fact race, and it refuses a project until project's created fact has folded
 * (ADR-174 decisions 15, 17). Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { INSTANT_EVAL_SPEND_MODEL } from "@langwatch/instant-eval-judge-contract";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instantEvalJudgeOverMemory } from "../../__tests__/support/instant-eval-judge-over-memory.test-fakes.ts";
import { judgeFactOwner } from "./instant-eval-judge-facts.fixture.ts";

const ORGANIZATION = "org-acme";
const OCCURRED_AT = Date.UTC(2026, 9, 6);
const CENTS = 10_000_000;

function judgeOnEventing() {
  const judge = instantEvalJudgeOverMemory();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const append = judgeFactOwner(eventing);
  eventing.register(judge.factsPipeline());
  const spend = eventing.register(judge.spendPipeline());
  judge.connectSpend((fact) => spend.commands.recordSpendPriced.send(fact));
  return { judge, eventing, spend, append };
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

  describe("given the judge was just deployed and holds no projects", () => {
    describe("when a judge call arrives for a project created before the deploy", () => {
      /** @scenario "The judge refuses calls until the project catch-up has run, then judges them" */
      it("refuses it as unknown, then classifies the same call once project's created fact folds", async () => {
        const { judge, eventing, append } = judgeOnEventing();
        close = () => eventing.close();
        const call = {
          projectId: "project-old-1",
          text: "Thanks so much for your help!",
          questions: [{ id: "polite", kind: "boolean", instructions: "Is it polite?" }],
        } as const;

        const before = await judge.judges.judge(call);
        expect(before).toMatchObject({ outcome: "refused", code: "instant_eval_project_unknown" });

        await append(
          {
            type: PROJECT_CREATED_EVENT_TYPE,
            data: {
              tenantId: "project-old-1",
              projectId: "project-old-1",
              organizationId: ORGANIZATION,
              occurredAt: 10,
            },
          },
          "event-created",
        );
        await vi.waitFor(() => expect(judge.rows.projects.has("project-old-1")).toBe(true));
        const after = await judge.judges.judge(call);

        expect(after).toMatchObject({
          outcome: "judged",
          judgement: { verdicts: [{ questionId: "polite", probability: 1 }] },
        });
      });
    });
  });
});
