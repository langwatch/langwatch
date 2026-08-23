/**
 * The settled spend record against real ClickHouse: an admission the
 * sweeper settled records unknown cost (never zero) with
 * NeedsReconciliation set, and a late confirmation supersedes it.
 *
 * The sweeper process itself is covered by
 * `spendSettlement.process.unit.test.ts`, which needs no container.
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

const ns = `settle-fold-${nanoid(8)}`;
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);
const GRACE_MS = 60_000;

describe("settlement on the spend record (real ClickHouse)", () => {
  /** @scenario The full settlement sequence: silent admission settles, a late confirmation supersedes */
  it("folds admit, settle, then a late confirm superseding the settled row", async () => {
    const { startTestContainers, stopTestContainers } = await import(
      "~/server/event-sourcing/__tests__/integration/testContainers"
    );
    const { GatewaySpendEventsRepository } = await import(
      "~/server/gateway/spendEvents.clickhouse.repository"
    );
    const { GatewaySpendFoldProjection } = await import(
      "../projections/gatewaySpend.foldProjection"
    );
    const { GatewaySpendStore } = await import(
      "../projections/gatewaySpend.store"
    );
    const { spendRowToEnvelope } = await import("@ee/webhooks/envelope");
    const { EventUtils, createTenantId } = await import("@langwatch/eventing");
    const constants = await import("../schemas/constants");

    const containers = await startTestContainers();
    const repo = new GatewaySpendEventsRepository(
      async () => containers.clickHouseClient,
    );
    const foldStore = new GatewaySpendStore(repo);
    const projection = new GatewaySpendFoldProjection({
      store: foldStore as never,
    });
    const tenant = `settle-fold-${ns}`;
    const requestId = `req-${ns}`;
    const context = {
      tenantId: createTenantId(tenant),
      aggregateId: requestId,
    };

    const makeEvent = (
      type: string,
      data: Record<string, unknown>,
      at: number,
    ) =>
      EventUtils.createEvent({
        aggregateType: constants.GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: requestId,
        tenantId: createTenantId(tenant),
        type,
        version: constants.GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: at,
        idempotencyKey: `${tenant}:${requestId}:${type}:${at}`,
      } as never) as never;

    try {
      // 1. Admission with no outcome: the record exists, cost unknown.
      const admittedState = projection.handleGatewaySpendAdmitted(
        makeEvent(
          constants.GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0,
            organization_id: "org-settle",
            tenantId: tenant,
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
          constants.GATEWAY_SPEND_SETTLED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0 + GRACE_MS,
            tenantId: tenant,
            reason: "confirmation_deadline_expired",
          },
          T0 + GRACE_MS,
        ),
        admittedState,
      );
      await foldStore.store(settledState, context);

      const afterSettle = await repo.readSpendEventsPage({
        tenantId: tenant,
        fromMs: T0 - 1000,
        toMs: T0 + GRACE_MS * 2,
        filters: {},
        limit: 10,
      });
      expect(afterSettle.rows).toHaveLength(1);
      expect(afterSettle.rows[0]!.status).toBe("settled");
      expect(afterSettle.rows[0]!.needsReconciliation).toBe(true);
      const settledEnvelope = spendRowToEnvelope(afterSettle.rows[0]!);
      expect(settledEnvelope.type).toBe("gateway.request.settled");
      expect(settledEnvelope.data.cost).toBeNull();
      expect(settledEnvelope.data.usage).toBeNull();

      // 3. The late confirmation supersedes: replace, never sum.
      const confirmedState = projection.handleGatewaySpendConfirmed(
        makeEvent(
          constants.GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0 + GRACE_MS + 5_000,
            tenantId: tenant,
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
        tenantId: tenant,
        fromMs: T0 - 1000,
        toMs: T0 + GRACE_MS * 2,
        filters: {},
        limit: 10,
      });
      expect(afterConfirm.rows).toHaveLength(1);
      expect(afterConfirm.rows[0]!.status).toBe("confirmed");
      expect(afterConfirm.rows[0]!.needsReconciliation).toBe(false);
      expect(afterConfirm.rows[0]!.costNanoUsd).toBe(2_875_000);
      const completedEnvelope = spendRowToEnvelope(afterConfirm.rows[0]!);
      expect(completedEnvelope.type).toBe("gateway.request.completed");
      expect(completedEnvelope.id).toBe(`${requestId}:completed`);
      expect(completedEnvelope.data.gateway_request_id).toBe(requestId);
    } finally {
      await containers.clickHouseClient.command({
        query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenant}'`,
      });
      await stopTestContainers();
    }
  }, 180_000);
});
