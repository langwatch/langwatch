import {
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  EventUtils,
  type FoldProjectionStore,
  type JsonValue,
} from "@langwatch/eventing";
import { GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, type SpendUsage } from "@langwatch/gateway-contract";
import type { GatewaySpendConfirmedEvent } from "@langwatch/gateway-process";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { webhookEnvelopeFromSpendRow } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "../eventing/gateway-debit.process.ts";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
} from "../eventing/gateway-spend-commands.process.ts";
import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../eventing/gateway-spend.projection.ts";
import type { GatewayInternalStoreRepository } from "../repositories/gateway-internal-store.repository.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../services/gateway-internal-protocol.service.ts";
import type { GatewaySpendRating } from "../services/model-catalog-gateway-spend-rating.service.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const TENANT = "project-1";
const REQUEST = "gwreq_1";
const PRICED_AT_APPEND = 4_262_500;
const PRICE_AFTER_CATALOG_CHANGE = 9_999_999;

describe("a spend outcome priced when its command was appended", () => {
  describe("when the model catalog changes before the other consumers run", () => {
    /** @scenario The price is fixed when the outcome is recorded and every surface repeats it */
    it("leaves the spend record, the budget debit and the webhook envelope stating one cost", async () => {
      let catalogPrice = PRICED_AT_APPEND;
      const rate = vi.fn((_input: { model: string; usage: SpendUsage }) => ({
        costNanoUsd: catalogPrice,
        rateVersion: "catalog@2026-07-26",
      }));
      const rating: GatewaySpendRating = { rate };
      const appended: Record<string, unknown>[] = [];
      const members: Partial<GatewayInternalProtocolMembers> = {
        spend: {
          commands: {
            admitSpend: { send: async () => undefined },
            confirmSpend: {
              send: async () => undefined,
              sendBatch: async (payloads: unknown[]) => {
                appended.push(...payloads.filter(isRecord));
              },
            },
            failSpend: { send: async () => undefined },
          },
          rating,
        },
        store: createApiFixture<GatewayInternalStoreRepository>({}),
        projects: createApiFixture<ProjectApi>({}),
      };
      const service = GatewayInternalProtocolService.create(
        new Proxy(members as GatewayInternalProtocolMembers, {
          get(target, property) {
            if (property in target) return Reflect.get(target, property);
            throw new Error(
              `the ingest reached "${String(property)}", which this test did not supply`,
            );
          },
        }),
      );

      await service.submitSpendCommands([
        {
          command: "confirmSpend",
          payload: {
            gateway_request_id: REQUEST,
            occurred_at: 1_760_000_000_000,
            project_id: TENANT,
            model: "openai/gpt-5-mini",
            model_provider_id: "provider-1",
            duration_ms: 120,
            usage: { input_tokens: 1000, output_tokens: 500 },
          },
          pod_id: "gw-test-1",
          pod_seq: 7,
        },
      ]);
      expect(appended).toHaveLength(1);
      catalogPrice = PRICE_AFTER_CATALOG_CHANGE;

      const confirmed = EventUtils.createEvent<GatewaySpendConfirmedEvent>({
        aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: REQUEST,
        tenantId: createTenantId(TENANT),
        type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data: appended[0] as GatewaySpendConfirmedEvent["data"],
        occurredAt: 1_760_000_000_000,
        idempotencyKey: `${TENANT}:${REQUEST}:confirmed`,
      });
      const projection = new GatewaySpendFoldProjection({
        store: {} as FoldProjectionStore<GatewaySpendState>,
      });
      const record = projection.handleGatewaySpendConfirmed(confirmed, projection.init());

      const definition = buildProcessDefinition(
        buildProcessManager({
          name: GATEWAY_DEBITS_PROCESS_NAME,
          applier: GatewayDebitProcess.create({
            debits: { write: () => Promise.reject(new Error("never reached")) },
          }).processManager(),
        }).config,
      );
      const outcome = {
        eventId: "evt-1",
        eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        occurredAt: 1_760_000_000_000,
        tenantId: TENANT,
        projectId: TENANT,
        processKey: REQUEST,
        payload: { ...appended[0], organization_id: "org-1", virtual_key_id: "vk-1" } as JsonValue,
      };
      const debit = definition.evolve({
        previousState: definition.initialState,
        ref: { processName: GATEWAY_DEBITS_PROCESS_NAME, projectId: TENANT, processKey: REQUEST },
        input: { kind: "event", now: 1_000, event: outcome },
      });

      const envelope = webhookEnvelopeFromSpendRow({
        tenantId: TENANT,
        gatewayRequestId: REQUEST,
        organizationId: "org-1",
        teamId: "",
        virtualKeyId: "vk-1",
        principalUserId: "",
        endUserId: "",
        traceId: "",
        model: record.model,
        providerKey: "",
        requestType: "chat",
        tokensInput: 1000,
        tokensOutput: 500,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensReasoning: 0,
        tokensInputImage: 0,
        tokensOutputImage: 0,
        imageCount: 0,
        costNanoUsd: record.costNanoUsd,
        costUsd: String(record.costNanoUsd / 1e9),
        rateVersion: record.rateVersion,
        status: "confirmed",
        errorClass: "",
        httpStatus: 0,
        needsReconciliation: false,
        settleReason: "",
        labels: [],
        metadata: "",
        durationMs: 120,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(1_760_000_000_000),
      });

      expect(rate).toHaveBeenCalledTimes(1);
      expect(record.costNanoUsd).toBe(PRICED_AT_APPEND);
      expect(
        debit.intents.map((intent) => (intent.payload as { cost_nano_usd: number }).cost_nano_usd),
      ).toEqual([PRICED_AT_APPEND]);
      expect(envelope.data).toMatchObject({ cost: { nano_usd: PRICED_AT_APPEND } });
    });
  });
});
