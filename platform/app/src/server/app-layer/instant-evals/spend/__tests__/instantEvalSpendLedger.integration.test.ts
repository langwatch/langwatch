/**
 * An Instant Eval's spend on the real ledger: the recorder's outcome, run
 * through the spend command and the fold, lands one `gateway_spend` row with
 * the run's tokens and the customer price, for a run and for a query.
 *
 * The command handler and the fold are the pipeline's own; only the transport
 * between them is short-circuited, because standing up the whole
 * event-sourcing runtime would test the framework rather than the row.
 *
 * @see ../spend-pipeline-instant-eval-spend.recorder.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ConfirmSpendCommand } from "~/server/event-sourcing/pipelines/gateway-spend-processing/commands/spendCommands";
import { GatewaySpendFoldProjection } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { GatewaySpendStore } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.store";
import type { ConfirmSpendCommandData } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { CONFIRM_SPEND_COMMAND_TYPE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import { INSTANT_EVAL_REQUEST_TYPE } from "../request-type";
import { SpendPipelineInstantEvalSpendRecorder } from "../spend-pipeline-instant-eval-spend.recorder";

const ns = nanoid(8);
const TENANT = `proj-instant-eval-spend-${ns}`;
const OCCURRED_AT = new Date(Date.UTC(2026, 8, 18, 10, 0, 0));

describe("Instant Eval spend on the gateway spend ledger (real ClickHouse)", () => {
  let repo: GatewaySpendEventsRepository;
  let store: GatewaySpendStore;
  let projection: GatewaySpendFoldProjection;
  let recorder: SpendPipelineInstantEvalSpendRecorder;
  let dispatched: ConfirmSpendCommandData[];

  /** Appends the outcome the way the pipeline would: command, then fold. */
  async function foldConfirm(data: ConfirmSpendCommandData): Promise<void> {
    const [event] = await new ConfirmSpendCommand().handle({
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.gateway_request_id,
      type: CONFIRM_SPEND_COMMAND_TYPE,
      data,
    } as never);
    const context = {
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.gateway_request_id,
    };
    const state = projection.handleGatewaySpendConfirmed(
      event!,
      (await store.get(data.gateway_request_id, context)) ?? projection.init(),
    );
    await store.store(state, context);
  }

  beforeAll(async () => {
    const containers = await startTestContainers();
    repo = new GatewaySpendEventsRepository(
      async () => containers.clickHouseClient,
    );
    store = new GatewaySpendStore(repo);
    projection = new GatewaySpendFoldProjection({ store: store as never });
    dispatched = [];
    recorder = new SpendPipelineInstantEvalSpendRecorder({
      attribution: async () => ({
        organizationId: `org-${ns}`,
        teamId: `team-${ns}`,
      }),
      dispatch: async (data) => {
        dispatched.push(data);
        await foldConfirm(data);
      },
    });
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  async function ledgerRows() {
    const page = await repo.readSpendEventsPage({
      tenantId: TENANT,
      fromMs: OCCURRED_AT.getTime() - 60_000,
      toMs: OCCURRED_AT.getTime() + 60_000,
      filters: { requestTypes: [INSTANT_EVAL_REQUEST_TYPE] },
      limit: 10,
    });
    return page.rows;
  }

  /** @scenario "A finished run lands one row on the spend ledger with the right amounts" */
  it("lands one confirmed row for a finished run, priced at the customer price", async () => {
    const runId = `instanteval_${ns}`;

    await recorder.recordSpend({
      projectId: TENANT,
      runId,
      inputTokens: 2_000_000,
      requests: 4_000,
      costUsd: 0.084,
      priceUsd: 0.1092,
      occurredAt: OCCURRED_AT,
    });
    // A retried finish appends the same request again: the fold re-sets the
    // same row rather than adding a second.
    await recorder.recordSpend({
      projectId: TENANT,
      runId,
      inputTokens: 2_000_000,
      requests: 4_000,
      costUsd: 0.084,
      priceUsd: 0.1092,
      occurredAt: OCCURRED_AT,
    });

    const rows = (await ledgerRows()).filter(
      (row) => row.gatewayRequestId === `instanteval_${runId}`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("confirmed");
    expect(row.requestType).toBe(INSTANT_EVAL_REQUEST_TYPE);
    expect(row.model).toBe("jev");
    expect(row.virtualKeyId).toBe("");
    expect(row.providerKey).toBe("");
    expect(row.organizationId).toBe(`org-${ns}`);
    expect(row.tokensInput).toBe(2_000_000);
    expect(row.tokensOutput).toBe(0);
    expect(row.costNanoUsd).toBe(109_200_000);
    expect(row.costUsd).toBe("0.1092");
    expect(JSON.parse(row.metadata)).toEqual({
      instant_eval: { cost_usd: 0.084, requests: 4_000, run_id: runId },
    });
    expect(row.occurredAt.getTime()).toBe(OCCURRED_AT.getTime());
  });

  /** @scenario "A synchronous query lands one row on the spend ledger" */
  it("lands one confirmed row of request type instant_eval for a query", async () => {
    const before = dispatched.length;

    await recorder.recordSpend({
      projectId: TENANT,
      inputTokens: 500,
      requests: 1,
      costUsd: 0.000021,
      priceUsd: 0.0000273,
      occurredAt: OCCURRED_AT,
    });

    const requestId = dispatched[before]!.gateway_request_id;
    expect(requestId).toMatch(/^instantevalquery_/);
    const rows = (await ledgerRows()).filter(
      (row) => row.gatewayRequestId === requestId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("confirmed");
    expect(rows[0]!.requestType).toBe(INSTANT_EVAL_REQUEST_TYPE);
    expect(rows[0]!.tokensInput).toBe(500);
    expect(rows[0]!.costNanoUsd).toBe(27_300);
    expect(JSON.parse(rows[0]!.metadata)).toEqual({
      instant_eval: { cost_usd: 0.000021, requests: 1 },
    });
  });

  it("sums the tenant's Instant Eval spend, and only that, for the free budget", async () => {
    const total = await repo.sumCostNanoUsdByRequestType({
      tenantIds: [TENANT],
      requestType: INSTANT_EVAL_REQUEST_TYPE,
    });
    expect(total).toBe(109_200_000 + 27_300);

    const windowed = await repo.sumCostNanoUsdByRequestType({
      tenantIds: [TENANT],
      requestType: INSTANT_EVAL_REQUEST_TYPE,
      fromMs: OCCURRED_AT.getTime() + 1,
      toMs: OCCURRED_AT.getTime() + 60_000,
    });
    expect(windowed).toBe(0);
  });
});
