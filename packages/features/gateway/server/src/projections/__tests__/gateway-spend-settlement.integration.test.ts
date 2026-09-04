/**
 * @vitest-environment node
 *
 * The settled spend record against real ClickHouse: an admission the sweeper
 * settled records unknown cost (never zero) with NeedsReconciliation set, and
 * a late confirmation supersedes it — replace, never sum.
 *
 * The sweeper process itself is covered by
 * `__tests__/gateway-spend-settlement.process.unit.test.ts`, which needs no
 * datastore.
 *
 * Spec: specs/ai-gateway/billing-spend-events.feature
 */

import { createTenantId, EventUtils } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "../../processes/gateway-spend-commands.process";
import { GatewaySpendEventsRepository } from "../../repositories/clickhouse/clickhouse.gateway-spend-events.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import { GatewaySpendStore } from "../../stores/gateway-spend/gateway-spend.store";
import { GatewaySpendFoldProjection } from "../gateway-spend.projection";

const chUrl = testClickHouseUrl();

const ns = `settle-fold-${nanoid(8)}`;
const TENANT = `settle-fold-${ns}`;
const REQUEST_ID = `req-${ns}`;
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);
const GRACE_MS = 60_000;

const client = chUrl ? createTestClickHouseClient(chUrl) : null;

function makeEvent(type: string, data: Record<string, unknown>, at: number) {
  return EventUtils.createEvent({
    aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
    aggregateId: REQUEST_ID,
    tenantId: createTenantId(TENANT),
    type,
    version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
    data,
    metadata: {},
    occurredAt: at,
    idempotencyKey: `${TENANT}:${REQUEST_ID}:${type}:${at}`,
  } as never) as never;
}

describe.skipIf(!chUrl)("settlement on the spend record (real ClickHouse)", () => {
  afterAll(async () => {
    if (!client) return;
    await client.command({
      query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${TENANT}'`,
    });
    await client.close();
  }, 60_000);

  /** @scenario "The full settlement sequence: silent admission settles, a late confirmation supersedes" */
  it("folds admit, settle, then a late confirm superseding the settled row", async () => {
    const repo = new GatewaySpendEventsRepository(async () => client!);
    const foldStore = GatewaySpendStore.create(repo);
    const projection = new GatewaySpendFoldProjection({ store: foldStore });
    const context = { tenantId: createTenantId(TENANT), aggregateId: REQUEST_ID };

    // 1. Admission with no outcome: the record exists, cost unknown.
    const admittedState = projection.handleGatewaySpendAdmitted(
      makeEvent(
        GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
        {
          gateway_request_id: REQUEST_ID,
          occurred_at: T0,
          organization_id: "org-settle",
          tenantId: TENANT,
          virtual_key_id: "vk-settle",
          principal_user_id: "",
          end_user_id: "settle-user",
          model: "openai/gpt-5",
          model_provider_id: "prov-1",
          trace_id: "",
          request_type: "chat",
          labels: [],
          metadata: "",
          pod_id: "pod-1",
          pod_seq: 1,
        },
        T0,
      ),
      projection.init(),
    );
    await foldStore.store(admittedState, context);

    // 2. The sweeper settles: unknown is recorded, never zeroed away.
    const settledState = projection.handleGatewaySpendSettled(
      makeEvent(
        GATEWAY_SPEND_SETTLED_EVENT_TYPE,
        {
          gateway_request_id: REQUEST_ID,
          occurred_at: T0 + GRACE_MS,
          tenantId: TENANT,
          reason: "confirmation_deadline_expired",
        },
        T0 + GRACE_MS,
      ),
      admittedState,
    );
    await foldStore.store(settledState, context);

    const afterSettle = await repo.readSpendEventsPage({
      tenantId: TENANT,
      fromMs: T0 - 1000,
      toMs: T0 + GRACE_MS * 2,
      filters: {},
      limit: 10,
    });
    expect(afterSettle.rows).toHaveLength(1);
    expect(afterSettle.rows[0]!.status).toBe("settled");
    expect(afterSettle.rows[0]!.needsReconciliation).toBe(true);
    expect(afterSettle.rows[0]!.costNanoUsd).toBe(0);
    expect(afterSettle.rows[0]!.settleReason).toBe("confirmation_deadline_expired");

    // 3. The late confirmation supersedes: replace, never sum.
    const confirmedState = projection.handleGatewaySpendConfirmed(
      makeEvent(
        GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        {
          gateway_request_id: REQUEST_ID,
          occurred_at: T0 + GRACE_MS + 5_000,
          tenantId: TENANT,
          model: "openai/gpt-5",
          model_provider_id: "prov-1",
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            reasoning_tokens: 0,
            cache_creation_1h_tokens: 0,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            input_chars: 0,
            audio_ms: 0,
          },
          cost_nano_usd: 2_875_000,
          rate_version: "catalog@2026-07-26",
          duration_ms: 2_000,
        },
        T0 + GRACE_MS + 5_000,
      ),
      settledState,
    );
    await foldStore.store(confirmedState, context);

    const afterConfirm = await repo.readSpendEventsPage({
      tenantId: TENANT,
      fromMs: T0 - 1000,
      toMs: T0 + GRACE_MS * 2,
      filters: {},
      limit: 10,
    });
    expect(afterConfirm.rows).toHaveLength(1);
    expect(afterConfirm.rows[0]!.status).toBe("confirmed");
    expect(afterConfirm.rows[0]!.needsReconciliation).toBe(false);
    expect(afterConfirm.rows[0]!.costNanoUsd).toBe(2_875_000);
    expect(afterConfirm.rows[0]!.gatewayRequestId).toBe(REQUEST_ID);
  }, 180_000);
});
