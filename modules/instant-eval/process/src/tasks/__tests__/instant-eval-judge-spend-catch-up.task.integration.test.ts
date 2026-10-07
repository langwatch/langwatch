/**
 * @vitest-environment node
 * The spend catch-up copies the gateway ledger's confirmed Instant Evals rows into the judge's
 * real spend over memory tables, by request id, with no cutover (ADR-174 decision 17).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { GatewayApi, GatewayConfirmedSpendRow } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_REQUEST_TYPE,
  INSTANT_EVAL_SPEND_MODEL,
} from "@langwatch/instant-eval-judge-contract";
import { instantEvalJudgeOverMemory } from "@langwatch/instant-eval-judge-process/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstantEvalJudgeSpendCatchUpService } from "../../services/instant-eval-judge-spend-catch-up.service.ts";
import { InstantEvalJudgeSpendCatchUpTask } from "../instant-eval-judge-spend-catch-up.task.ts";

const ORGANIZATION = "org-acme";
const PROJECTS = ["project-1", "project-2"];
const OCCURRED_AT = Date.UTC(2026, 9, 6);
const CENTS = 10_000_000;

/** A confirmed ledger row, Instant Evals unless it names another request type. */
type LedgerRow = GatewayConfirmedSpendRow & { requestType?: string };

/**
 * The ledger's confirmed Instant Evals rows, a page of one row at a time, so every read follows
 * the cursor. Rows outside the tenants or the request type asked for are never answered.
 */
function ledgerOf(rows: LedgerRow[]) {
  const listConfirmedSpendByRequestType: GatewayApi["listConfirmedSpendByRequestType"] = async ({
    tenantIds,
    requestType,
    cursor,
  }) => {
    const matching = rows.filter(
      (row) =>
        tenantIds.includes(row.tenantId) &&
        (row.requestType ?? INSTANT_EVAL_REQUEST_TYPE) === requestType,
    );
    const at = cursor ? Number(cursor) : 0;
    const row = matching[at];
    if (!row) return { rows: [], nextCursor: null };
    const { requestType: _type, ...confirmed } = row;
    return { rows: [confirmed], nextCursor: String(at + 1) };
  };
  return { listConfirmedSpendByRequestType };
}

function ledgerRow({
  requestId,
  cents,
  tenantId = "project-1",
}: {
  requestId: string;
  cents: number;
  tenantId?: string;
}): GatewayConfirmedSpendRow {
  return { tenantId, requestId, costNanoUsd: cents * CENTS, occurredAt: OCCURRED_AT };
}

function catchUpBesideJudge({ ledger }: { ledger: LedgerRow[] }) {
  const judge = instantEvalJudgeOverMemory();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const spend = eventing.register(judge.spendPipeline());
  judge.connectSpend((fact) => spend.commands.recordSpendPriced.send(fact));
  const service = InstantEvalJudgeSpendCatchUpService.create({
    peers: {
      listProjectIds: async ({ organizationId }) =>
        organizationId === ORGANIZATION ? PROJECTS : [],
      ledger: ledgerOf(ledger),
      judges: judge.judges,
    },
  });
  const task = InstantEvalJudgeSpendCatchUpTask.create({
    organizations: { findAllIds: async () => [ORGANIZATION, "org-without-projects"] },
    instantEvals: { copyLedgerSpendToJudge: (input) => service.copyLedgerSpend(input) },
  });
  const runTask = () => task.run({ args: [], signal: new AbortController().signal });
  const spendOf = () => judge.spendNanoUsdOf({ organizationId: ORGANIZATION });
  return { judge, eventing, spend, runTask, spendOf };
}

describe("InstantEvalJudgeSpendCatchUpTask", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given $0.40 of Instant Evals spend in the gateway ledger over two requests", () => {
    describe("when the spend catch-up runs twice", () => {
      /** @scenario "The spend catch-up copies every ledger row once" */
      it("holds $0.40 for the organization, one row for each request", async () => {
        const { judge, eventing, runTask, spendOf } = catchUpBesideJudge({
          ledger: [
            ledgerRow({ requestId: "instanteval_run-1", cents: 15 }),
            ledgerRow({ requestId: "instanteval_run-2", cents: 25, tenantId: "project-2" }),
            { ...ledgerRow({ requestId: "chat-1", cents: 99 }), requestType: "chat" },
            ledgerRow({ requestId: "instanteval_elsewhere", cents: 99, tenantId: "project-x" }),
          ],
        });
        close = () => eventing.close();

        await runTask();
        await runTask();

        expect(await spendOf()).toBe(BigInt(40 * CENTS));
        expect([...judge.rows.spend.values()].map((row) => row.requestId).toSorted()).toEqual([
          "instanteval_run-1",
          "instanteval_run-2",
        ]);
      });
    });
  });

  describe("given the judge holds $0.40, and old pods wrote $0.20 more to the ledger only", () => {
    describe("when the spend catch-up runs again", () => {
      /** @scenario "A re-run spend catch-up copies the spend old pods wrote during a rollback" */
      it("holds $0.60 for the organization", async () => {
        const ledger = [
          ledgerRow({ requestId: "instanteval_run-1", cents: 15 }),
          ledgerRow({ requestId: "instanteval_run-2", cents: 25 }),
        ];
        const { eventing, runTask, spendOf } = catchUpBesideJudge({ ledger });
        close = () => eventing.close();
        await runTask();
        expect(await spendOf()).toBe(BigInt(40 * CENTS));

        ledger.push(ledgerRow({ requestId: "instanteval_run-rollback", cents: 20 }));
        await runTask();

        expect(await spendOf()).toBe(BigInt(60 * CENTS));
      });
    });
  });

  describe("given the gateway ledger holds a $0.10 Instant Evals request", () => {
    /** @scenario "A request in both the ledger and the judge is counted once" */
    it.each([{ when: "before" }, { when: "after" }])(
      "counts it once when the judge's priced event is folded $when the spend catch-up runs",
      async ({ when }) => {
        const requestId = "instanteval_run-both";
        const { judge, eventing, spend, runTask, spendOf } = catchUpBesideJudge({
          ledger: [ledgerRow({ requestId, cents: 10 })],
        });
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
        await runTask();
        if (when === "after") await foldPriced();

        expect(await spendOf()).toBe(BigInt(10 * CENTS));
        expect(judge.rows.spend.size).toBe(1);
      },
    );
  });
});
