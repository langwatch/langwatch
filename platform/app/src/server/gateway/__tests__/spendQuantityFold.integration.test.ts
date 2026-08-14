/**
 * @vitest-environment node
 *
 * The billable quantities' round trip through the fold store, against real
 * ClickHouse.
 *
 * Three properties make the widening safe to deploy without a projection
 * version bump: a quantity written by the fold reads back as itself, a row
 * written before the columns existed still decodes and keeps its committed
 * money, and a late admission folding over a confirmed request restates the
 * quantities rather than zeroing them.
 *
 * Spec: specs/ai-gateway/billing-spend-events.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  getTestClickHouseClient,
  startTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { GatewaySpendState } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { GATEWAY_SPEND_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { GatewaySpendEventsRepository } from "../spendEvents.clickhouse.repository";

const suffix = nanoid(8);
const TENANT = `proj-qty-${suffix}`;
const OCCURRED_AT_MS = Date.now() - 60 * 60 * 1000;

function ch(): ClickHouseClient {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("test ClickHouse client not available");
  return client;
}

function repository(): GatewaySpendEventsRepository {
  return new GatewaySpendEventsRepository(async () => ch());
}

let version = 1;

/** A confirmed spend record carrying whichever quantities the case needs. */
function confirmedState(
  usage: Partial<NonNullable<GatewaySpendState["usage"]>>,
  costNanoUsd: number,
): GatewaySpendState {
  const stamp = version++;
  return {
    status: "confirmed",
    organizationId: `org-qty-${suffix}`,
    virtualKeyId: `vk_qty_${suffix}`,
    principalUserId: "",
    endUserId: "",
    model: "openai/tts-1",
    providerKey: "pk-openai",
    traceId: "",
    requestType: "audio.speech",
    labels: [],
    metadataJson: "",
    podId: "pod-1",
    podSeq: stamp,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_1h_tokens: 0,
      reasoning_tokens: 0,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      input_chars: 0,
      audio_ms: 0,
      ...usage,
    },
    rateVersion: "registry@2026-08-14",
    costNanoUsd,
    errorType: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: OCCURRED_AT_MS,
    durationMs: 250,
    createdAt: OCCURRED_AT_MS,
    updatedAt: OCCURRED_AT_MS + stamp,
    LastEventOccurredAt: OCCURRED_AT_MS,
  };
}

describe("gateway spend quantities through the fold store (real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();
  });

  it("round-trips a speech call's characters", async () => {
    const gatewayRequestId = `req-chars-${nanoid(10)}`;
    await repository().upsertFromFold([
      {
        tenantId: TENANT,
        gatewayRequestId,
        state: confirmedState({ input_chars: 4000 }, 60_000_000),
      },
    ]);

    const read = await repository().readForFold({
      tenantId: TENANT,
      gatewayRequestId,
    });

    expect(read?.usage?.input_chars).toBe(4000);
    expect(read?.costNanoUsd).toBe(60_000_000);
  });

  it("round-trips every quantity the vocabulary carries", async () => {
    const gatewayRequestId = `req-all-${nanoid(10)}`;
    await repository().upsertFromFold([
      {
        tenantId: TENANT,
        gatewayRequestId,
        state: confirmedState(
          {
            input_tokens: 200,
            output_tokens: 50,
            input_audio_tokens: 800,
            output_audio_tokens: 250,
            cache_creation_1h_tokens: 17,
            input_chars: 4000,
            audio_ms: 1234,
          },
          43_200_000,
        ),
      },
    ]);

    const read = await repository().readForFold({
      tenantId: TENANT,
      gatewayRequestId,
    });

    expect(read?.usage).toMatchObject({
      input_tokens: 200,
      output_tokens: 50,
      input_audio_tokens: 800,
      output_audio_tokens: 250,
      cache_creation_1h_tokens: 17,
      input_chars: 4000,
      audio_ms: 1234,
    });
  });

  it("keeps the committed money on a row written before the columns existed", async () => {
    // A row the previous build wrote: the quantity columns are absent from
    // the insert entirely, so ClickHouse serves their defaults. The version
    // stamp is the CURRENT one, which is the whole point of not bumping it:
    // the row decodes instead of reporting a store miss, and a miss would
    // fold from init() and overwrite this committed state.
    const gatewayRequestId = `req-old-${nanoid(10)}`;
    await ch().insert({
      table: "gateway_spend",
      values: [
        {
          TenantId: TENANT,
          GatewayRequestId: gatewayRequestId,
          OrganizationId: `org-qty-${suffix}`,
          VirtualKeyId: `vk_qty_${suffix}`,
          PrincipalUserId: "",
          EndUserId: "",
          TraceId: "",
          Model: "openai/gpt-4o",
          ProviderKey: "pk-openai",
          RequestType: "chat",
          Status: "confirmed",
          ErrorClass: "",
          HttpStatus: 200,
          NeedsReconciliation: 0,
          SettleReason: "",
          TokensInput: 869,
          TokensOutput: 207,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          TokensReasoning: 0,
          CostNanoUSD: 5_242_000,
          RateVersion: "registry@2026-07-29",
          Labels: [],
          Metadata: "",
          PodId: "pod-old",
          PodSeq: 1,
          DurationMS: 3878,
          OccurredAt: new Date(OCCURRED_AT_MS),
          Version: GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
          CreatedAt: OCCURRED_AT_MS,
          LastEventOccurredAt: OCCURRED_AT_MS,
          EventTimestamp: OCCURRED_AT_MS,
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });

    const read = await repository().readForFold({
      tenantId: TENANT,
      gatewayRequestId,
    });

    expect(read).not.toBeNull();
    expect(read?.costNanoUsd).toBe(5_242_000);
    expect(read?.usage).toMatchObject({
      input_tokens: 869,
      output_tokens: 207,
      input_chars: 0,
      audio_ms: 0,
      input_audio_tokens: 0,
    });
  });

  it("does not zero the quantities when a late admission folds over the outcome", async () => {
    const gatewayRequestId = `req-late-${nanoid(10)}`;
    const confirmed = confirmedState(
      { input_audio_tokens: 800, output_audio_tokens: 250, audio_ms: 60_000 },
      43_200_000,
    );
    await repository().upsertFromFold([
      { tenantId: TENANT, gatewayRequestId, state: confirmed },
    ]);

    // The admission arrives after the outcome. The fold loads this state
    // from the store, fills the attribution and writes the whole row back,
    // so anything readForFold cannot decode is lost on this write.
    const loaded = await repository().readForFold({
      tenantId: TENANT,
      gatewayRequestId,
    });
    expect(loaded).not.toBeNull();
    await repository().upsertFromFold([
      {
        tenantId: TENANT,
        gatewayRequestId,
        state: {
          ...loaded!,
          endUserId: "user_9",
          traceId: "trace-1",
          updatedAt: loaded!.updatedAt + 1,
        },
      },
    ]);

    const after = await repository().readForFold({
      tenantId: TENANT,
      gatewayRequestId,
    });

    expect(after?.endUserId).toBe("user_9");
    expect(after?.costNanoUsd).toBe(43_200_000);
    expect(after?.usage).toMatchObject({
      input_audio_tokens: 800,
      output_audio_tokens: 250,
      audio_ms: 60_000,
    });
  });
});
