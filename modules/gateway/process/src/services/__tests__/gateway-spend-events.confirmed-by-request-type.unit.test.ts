/**
 * @vitest-environment node
 * The confirmed rows of one request type, one page at a time, which the Instant Evals spend
 * catch-up copies into the judge by request id (ADR-174 decision 17).
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import { GatewaySpendEventsService } from "../../features/spend/services/gateway-spend-events.service.ts";
import { MemoryGatewaySpendEventsRepository } from "../../repositories/memory/memory.gateway-spend-events.repository.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";

const OCCURRED_AT = Temporal.Instant.from("2026-10-01T10:00:00Z").epochMilliseconds;

function spendState({
  status = "confirmed",
  requestType = "instant_eval",
  costNanoUsd = 200_000_000,
  updatedAt = 1,
}: {
  status?: GatewaySpendState["status"];
  requestType?: string;
  costNanoUsd?: number;
  updatedAt?: number;
}): GatewaySpendState {
  return {
    status,
    organizationId: "org_1",
    virtualKeyId: "",
    principalUserId: "",
    endUserId: "",
    model: "instant-evals",
    providerKey: "",
    traceId: "",
    requestType,
    labels: [],
    metadataJson: "{}",
    podId: "",
    podSeq: 0,
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: 10 },
    rateVersion: "",
    costNanoUsd,
    errorType: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: OCCURRED_AT,
    durationMs: 0,
    createdAt: 1,
    updatedAt,
    LastEventOccurredAt: 0,
  };
}

async function ledger() {
  const repository = MemoryGatewaySpendEventsRepository.create();
  await repository.upsertFromFold([
    { tenantId: "project_a", gatewayRequestId: "r1", state: spendState({ updatedAt: 1 }) },
    { tenantId: "project_a", gatewayRequestId: "r2", state: spendState({ updatedAt: 2 }) },
    {
      tenantId: "project_a",
      gatewayRequestId: "r3",
      state: spendState({ status: "admitted", updatedAt: 3 }),
    },
    {
      tenantId: "project_a",
      gatewayRequestId: "r4",
      state: spendState({ requestType: "chat", updatedAt: 4 }),
    },
  ]);
  await repository.upsertFromFold([
    { tenantId: "project_other", gatewayRequestId: "r5", state: spendState({ updatedAt: 5 }) },
  ]);
  return GatewaySpendEventsService.create(repository);
}

describe("GatewaySpendEventsService.listConfirmedSpendByRequestType", () => {
  describe("given confirmed, in-flight and other-type rows under two tenants", () => {
    it("pages only the confirmed rows of the request type under the tenants asked for", async () => {
      const service = await ledger();

      const first = await service.listConfirmedSpendByRequestType({
        tenantIds: ["project_a"],
        requestType: "instant_eval",
        limit: 1,
      });
      const second = await service.listConfirmedSpendByRequestType({
        tenantIds: ["project_a"],
        requestType: "instant_eval",
        cursor: first.nextCursor,
        limit: 1,
      });
      const last = await service.listConfirmedSpendByRequestType({
        tenantIds: ["project_a"],
        requestType: "instant_eval",
        cursor: second.nextCursor,
        limit: 1,
      });

      expect([...first.rows, ...second.rows]).toEqual([
        {
          tenantId: "project_a",
          requestId: "r1",
          costNanoUsd: 200_000_000,
          occurredAt: OCCURRED_AT,
        },
        {
          tenantId: "project_a",
          requestId: "r2",
          costNanoUsd: 200_000_000,
          occurredAt: OCCURRED_AT,
        },
      ]);
      expect(last).toEqual({ rows: [], nextCursor: null });
    });
  });
});
