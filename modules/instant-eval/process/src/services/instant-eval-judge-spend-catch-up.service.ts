/**
 * The spend catch-up: copies each confirmed Instant Evals row of the gateway ledger into the
 * judge's own spend under its request id (ADR-174 decision 17). There is no cutover: a request
 * the judge already holds is skipped, so a re-run at any time copies only the rows still missing.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GatewayApi } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_REQUEST_TYPE,
  type InstantEvalJudgeApi,
} from "@langwatch/instant-eval-judge-contract";

/** Rows read per ledger page; a page is copied before the next is read. */
const LEDGER_PAGE_SIZE = 500;

type InstantEvalJudgeSpendCatchUpPeers = Readonly<{
  /** The organization's projects, whose ids are the ledger's tenants. */
  listProjectIds: (input: { organizationId: string }) => Promise<string[]>;
  ledger: Pick<GatewayApi, "listConfirmedSpendByRequestType">;
  judges: Pick<InstantEvalJudgeApi, "copyLedgerSpend">;
}>;

/** How many of the organization's ledger rows were copied, and how many the judge held. */
export type InstantEvalJudgeSpendCatchUp = Readonly<{ copied: number; alreadyHeld: number }>;

export class InstantEvalJudgeSpendCatchUpService {
  private constructor(private readonly peers: InstantEvalJudgeSpendCatchUpPeers) {}

  static create({
    peers,
  }: {
    peers: InstantEvalJudgeSpendCatchUpPeers;
  }): InstantEvalJudgeSpendCatchUpService {
    return new InstantEvalJudgeSpendCatchUpService(peers);
  }

  async copyLedgerSpend({
    organizationId,
    signal,
  }: {
    organizationId: string;
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgeSpendCatchUp> {
    const tenantIds = await this.peers.listProjectIds({ organizationId });
    let copied = 0;
    let alreadyHeld = 0;
    let cursor: string | null = null;
    do {
      signal?.throwIfAborted();
      const page = await this.peers.ledger.listConfirmedSpendByRequestType({
        tenantIds,
        requestType: INSTANT_EVAL_REQUEST_TYPE,
        cursor,
        limit: LEDGER_PAGE_SIZE,
      });
      for (const row of page.rows) {
        const { outcome } = await this.peers.judges.copyLedgerSpend({
          organizationId,
          requestId: row.requestId,
          spendNanoUsd: row.costNanoUsd,
          occurredAt: row.occurredAt,
        });
        if (outcome === "copied") copied += 1;
        else alreadyHeld += 1;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return { copied, alreadyHeld };
  }
}
