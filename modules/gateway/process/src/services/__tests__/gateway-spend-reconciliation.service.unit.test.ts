/**
 * The reconciliation reads and the replay: what they refuse before touching
 * a store, and what a replay queues.
 * @see specs/ai-gateway/gateway-spend-rest.feature
 * @see specs/ai-gateway/billing-spend-events.feature
 */
import {
  GATEWAY_SPEND_REPLAY_MAX_ENVELOPES,
  type GatewaySpendEnvelope,
  type GatewaySpendSummariesQuery,
  gatewaySpendSummariesQuerySchema,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import { encodeSpendSummariesCursor } from "../../rules/gateway-spend-cursor.rules.ts";
import { FixedGatewaySettlementPolicyService } from "../fixed-gateway-settlement-policy.service.ts";
import {
  type GatewaySpendApp,
  GatewaySpendReconciliationService,
  type GatewaySpendWebhookEndpoint,
} from "../gateway-spend-reconciliation.service.ts";

const NOW = Date.now();
const SETTLED_TO = NOW - 24 * 60 * 60 * 1000;

const unreached = (): never => {
  throw new Error("a store was read before the request was refused");
};

const baseCollaborators: GatewaySpendApp = {
  getSpendEvents: unreached,
  getBudgetSpend: unreached,
  webhookEndpoints: unreached,
  webhookEvents: unreached,
  webhookDelivery: unreached,
  spendEventEnvelope: unreached,
  endpointAcceptsEvent: unreached,
  settlementPolicy: () => FixedGatewaySettlementPolicyService.create(30 * 60 * 1000),
  resolveSpendScope: unreached,
  endUserCaps: unreached,
};

function summariesQuery(overrides: Record<string, string>): GatewaySpendSummariesQuery {
  return gatewaySpendSummariesQuerySchema.parse({
    from: String(SETTLED_TO - 3_600_000),
    to: String(SETTLED_TO),
    ...overrides,
  });
}

describe("reading the summaries with a cursor", () => {
  const sut = GatewaySpendReconciliationService.create({ collaborators: baseCollaborators });

  /** @scenario A garbled cursor is refused, not silently reset */
  /** @scenario A garbled summaries cursor is refused, not silently reset */
  it("refuses a cursor that decodes to nothing, reading nothing", async () => {
    await expect(
      sut.answerSpendSummaries({
        organizationId: "org_1",
        query: summariesQuery({ group_by: "model", cursor: "%%%" }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  /** @scenario A cursor from another grouping is refused, not silently restarted */
  it("refuses a cursor minted under a different grouping and says to start again", async () => {
    const cursor = encodeSpendSummariesCursor(["gpt-5-mini", "user_1"]);

    await expect(
      sut.answerSpendSummaries({
        organizationId: "org_1",
        query: summariesQuery({ group_by: "model", cursor }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining("Start a new walk"),
    });
  });
});

const ENDPOINT: GatewaySpendWebhookEndpoint = { id: "we_1", enabledEvents: ["*"] };

function envelopes(count: number): GatewaySpendEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `evt_${index}`,
    type: "gateway.spend.recorded",
    created: "2026-09-01T00:00:00.000Z",
    schema_version: "1",
    data: {},
  }));
}

/** A replay over a log that serves the given envelopes in one page, recording what was queued. */
function replayOver(log: GatewaySpendEnvelope[]) {
  const queued: { id: string; replayId: string }[] = [];
  const sut = GatewaySpendReconciliationService.create({
    collaborators: {
      ...baseCollaborators,
      webhookEndpoints: () => ({ findDeliverable: async () => ENDPOINT }),
      webhookEvents: () => ({
        getEmittedEvents: async () => ({ events: log, nextCursor: null }),
      }),
      webhookDelivery: () => ({
        appendReplayToEndpointStream: async ({ envelope, replayId }) => {
          queued.push({ id: envelope.id, replayId });
        },
      }),
      endpointAcceptsEvent: () => true,
    },
  });
  return { sut, queued };
}

describe("replaying a window to one endpoint", () => {
  const body = { from: 1_000, to: 2_000, endpoint_id: "we_1" };

  /** @scenario Replay re-delivers a window's envelopes to one endpoint through the delivery path */
  it("queues every matching envelope on the delivery stream under its own id", async () => {
    const { sut, queued } = replayOver(envelopes(3));

    const { data } = await sut.answerSpendReplay({ organizationId: "org_1", body });

    expect(data.replayed).toBe(3);
    expect(queued.map(({ id }) => id)).toEqual(["evt_0", "evt_1", "evt_2"]);
    expect(new Set(queued.map(({ replayId }) => replayId))).toEqual(new Set([data.replay_id]));
  });

  /** @scenario An over-limit replay queues nothing */
  it("refuses a window past the cap before any envelope is queued", async () => {
    const { sut, queued } = replayOver(envelopes(GATEWAY_SPEND_REPLAY_MAX_ENVELOPES + 1));

    await expect(sut.answerSpendReplay({ organizationId: "org_1", body })).rejects.toMatchObject({
      status: 400,
    });
    expect(queued).toEqual([]);
  });
});
