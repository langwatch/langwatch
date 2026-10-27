/**
 * @vitest-environment node
 * The spend catch-up copies the gateway ledger's confirmed Instant Evals rows to the judge by
 * request id, with no cutover (ADR-174 decision 17). The judge is its contract here; its own
 * spend rows are bound in the judge's suite.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GatewayApi, GatewayConfirmedSpendRow } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_REQUEST_TYPE,
  type InstantEvalJudgeApi,
} from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { InstantEvalJudgeSpendBackfillService } from "../instant-eval-judge-spend-backfill.service.ts";
import { InstantEvalJudgeSpendCatchUpService } from "../instant-eval-judge-spend-catch-up.service.ts";

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

/** A judge that holds spend by request id, answering as the contract says. */
function judgeHolding() {
  const held = new Map<string, number>();
  const judges = createApiFixture<Pick<InstantEvalJudgeApi, "copyLedgerSpend">>({
    copyLedgerSpend: async ({ requestId, spendNanoUsd }) => {
      if (held.has(requestId)) return { outcome: "already_held" };
      held.set(requestId, spendNanoUsd);
      return { outcome: "copied" };
    },
  });
  const spendNanoUsd = () => [...held.values()].reduce((sum, nanoUsd) => sum + nanoUsd, 0);
  return { judges, held, spendNanoUsd };
}

function catchUpBesideJudge({ ledger }: { ledger: LedgerRow[] }) {
  const judge = judgeHolding();
  const service = InstantEvalJudgeSpendCatchUpService.create({
    peers: {
      listProjectIds: async ({ organizationId }) =>
        organizationId === ORGANIZATION ? PROJECTS : [],
      ledger: ledgerOf(ledger),
      judges: judge.judges,
    },
  });
  const backfill = InstantEvalJudgeSpendBackfillService.create({
    peers: {
      organizations: {
        listAllIds: async () => ({ ids: [ORGANIZATION, "org-without-projects"], next: null }),
      },
      copy: (input) => service.copyLedgerSpend(input),
    },
  });
  const runStep = () =>
    backfill.backfill({
      after: undefined,
      dryRun: false,
      signal: new AbortController().signal,
      onPage: async () => {},
    });
  return { judge, runStep };
}

describe("InstantEvalJudgeSpendBackfillService", () => {
  describe("given $0.40 of Instant Evals spend in the gateway ledger over two requests", () => {
    describe("when the spend catch-up runs twice", () => {
      /** @scenario "The spend catch-up copies every ledger row once" */
      it("holds $0.40 for the organization, one row for each request", async () => {
        const { judge, runStep } = catchUpBesideJudge({
          ledger: [
            ledgerRow({ requestId: "instanteval_run-1", cents: 15 }),
            ledgerRow({ requestId: "instanteval_run-2", cents: 25, tenantId: "project-2" }),
            { ...ledgerRow({ requestId: "chat-1", cents: 99 }), requestType: "chat" },
            ledgerRow({ requestId: "instanteval_elsewhere", cents: 99, tenantId: "project-x" }),
          ],
        });

        await runStep();
        await runStep();

        expect(judge.spendNanoUsd()).toBe(40 * CENTS);
        expect([...judge.held.keys()].toSorted()).toEqual([
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
        const { judge, runStep } = catchUpBesideJudge({ ledger });
        await runStep();
        expect(judge.spendNanoUsd()).toBe(40 * CENTS);

        ledger.push(ledgerRow({ requestId: "instanteval_run-rollback", cents: 20 }));
        await runStep();

        expect(judge.spendNanoUsd()).toBe(60 * CENTS);
      });
    });
  });
});
