/**
 * The spend replay: what a replay queues, and that an over-limit window queues nothing.
 * @see specs/ai-gateway/billing-spend-events.feature
 */
import { WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES } from "@langwatch/webhook-contract";
import type { WebhookEnvelope } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import {
  type WebhookReplayEndpoint,
  WebhookSpendReplayService,
} from "../webhook-spend-replay.service.ts";

const ENDPOINT: WebhookReplayEndpoint = { id: "we_1", enabledEvents: ["*"] };

function envelopes(count: number): WebhookEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `evt_${index}`,
    type: "gateway.spend.recorded",
    created: "2026-09-01T00:00:00.000Z",
    schema_version: "1",
    data: {},
  }));
}

/** A replay over a log that serves the given envelopes in one page, recording what was queued. */
function replayOver(log: WebhookEnvelope[]) {
  const queued: { id: string; replayId: string }[] = [];
  const sut = WebhookSpendReplayService.create({
    findDeliverable: async () => ENDPOINT,
    getEmittedEvents: async () => ({ events: log, nextCursor: null }),
    appendReplayToEndpointStream: async ({ envelope, replayId }) => {
      queued.push({ id: envelope.id, replayId });
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
    const { sut, queued } = replayOver(envelopes(WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES + 1));

    await expect(sut.answerSpendReplay({ organizationId: "org_1", body })).rejects.toMatchObject({
      status: 400,
    });
    expect(queued).toEqual([]);
  });
});
