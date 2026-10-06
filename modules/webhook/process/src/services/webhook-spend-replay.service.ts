/**
 * The spend replay behind `POST /api/gateway/v1/spend-events/replay`: re-delivers a window of
 * already-emitted envelopes to one endpoint through its normal delivery path. Moved from gateway
 * with its wire unchanged; the refusals are the ones the route always gave.
 */
import { BadRequestError } from "@langwatch/api/rest";
import { generate } from "@langwatch/ksuid";
import { Temporal } from "@langwatch/time";
import {
  eventMatches,
  WEBHOOK_SPEND_REPLAY_KSUID_RESOURCE,
  WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES,
  WEBHOOK_SPEND_REPLAY_PAGE_SIZE,
  type WebhookEnvelope,
  type WebhookSpendReplayBody,
  type WebhookSpendReplayResponse,
} from "@langwatch/webhook-contract";

/** A deliverable endpoint, reduced to what a replay reads off it. */
export type WebhookReplayEndpoint = {
  id: string;
  enabledEvents: readonly string[];
};

/** What a replay reads and appends to: webhook's own registry, emitted log and stream. */
type WebhookSpendReplayCollaborators = Readonly<{
  findDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookReplayEndpoint | null>;
  getEmittedEvents(input: {
    organizationId: string;
    fromMs: number;
    toMs: number;
    cursor: string | null;
    limit: number;
  }): Promise<{ events: WebhookEnvelope[]; nextCursor: string | null }>;
  appendReplayToEndpointStream(input: {
    organizationId: string;
    endpoint: WebhookReplayEndpoint;
    envelope: WebhookEnvelope;
    replayId: string;
  }): Promise<void>;
}>;

type ReplayWindow = {
  collaborators: WebhookSpendReplayCollaborators;
  endpoint: WebhookReplayEndpoint;
  organizationId: string;
  fromMs: number;
  toMs: number;
};

function accepts(endpoint: WebhookReplayEndpoint, envelope: WebhookEnvelope): boolean {
  return eventMatches(endpoint.enabledEvents, envelope.type);
}

/** Refuses as soon as the cap is passed, BEFORE any envelope is queued: no partial ships. */
async function assertReplayWindowWithinCap({
  collaborators,
  endpoint,
  organizationId,
  fromMs,
  toMs,
}: ReplayWindow): Promise<void> {
  let matching = 0;
  let cursor: string | null = null;
  do {
    const page = await collaborators.getEmittedEvents({
      organizationId,
      fromMs,
      toMs,
      cursor,
      limit: WEBHOOK_SPEND_REPLAY_PAGE_SIZE,
    });
    for (const envelope of page.events) {
      if (!accepts(endpoint, envelope)) continue;
      matching++;
      if (matching > WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES) {
        throw new BadRequestError(
          `the window holds more than ${WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES} envelopes; narrow it`,
        );
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
}

/** Appends every matching envelope in the window to the endpoint's stream; answers how many. */
async function appendWindowToEndpointStream({
  collaborators,
  endpoint,
  organizationId,
  fromMs,
  toMs,
  replayId,
}: ReplayWindow & { replayId: string }): Promise<number> {
  let replayed = 0;
  let cursor: string | null = null;
  do {
    const page = await collaborators.getEmittedEvents({
      organizationId,
      fromMs,
      toMs,
      cursor,
      limit: WEBHOOK_SPEND_REPLAY_PAGE_SIZE,
    });
    const matching = page.events.filter((envelope) => accepts(endpoint, envelope));
    // Folds landing between the preflight and this pass can still grow the window:
    // ship up to the cap and stop, and the response reports what actually went out.
    const shippable = matching.slice(0, WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES - replayed);
    for (const envelope of shippable) {
      await collaborators.appendReplayToEndpointStream({
        organizationId,
        endpoint,
        envelope,
        replayId,
      });
      replayed++;
    }
    cursor = shippable.length < matching.length ? null : page.nextCursor;
  } while (cursor);
  return replayed;
}

/** One replay of a spend window to one endpoint, refused whole when past the caps. */
export class WebhookSpendReplayService {
  static create(collaborators: WebhookSpendReplayCollaborators): WebhookSpendReplayService {
    return new WebhookSpendReplayService(collaborators);
  }

  private constructor(private readonly collaborators: WebhookSpendReplayCollaborators) {}

  async answerSpendReplay({
    organizationId,
    body,
  }: {
    organizationId: string;
    body: WebhookSpendReplayBody;
  }): Promise<WebhookSpendReplayResponse> {
    const endpoint = await this.collaborators.findDeliverable({
      organizationId,
      endpointId: body.endpoint_id,
    });
    if (!endpoint) {
      throw new BadRequestError("unknown or inactive endpoint for this organization");
    }
    const window = {
      collaborators: this.collaborators,
      endpoint,
      organizationId,
      fromMs: body.from,
      toMs: body.to,
    };

    await assertReplayWindowWithinCap(window);
    // One replay identity per call salts batch and inbox source ids, so redelivered
    // envelopes cannot collide with their historical batches; envelope ids stay untouched.
    const replayId = generate(WEBHOOK_SPEND_REPLAY_KSUID_RESOURCE).toString();
    const replayed = await appendWindowToEndpointStream({ ...window, replayId });

    return {
      data: {
        endpoint_id: endpoint.id,
        replay_id: replayId,
        replayed,
        window: {
          from: Temporal.Instant.fromEpochMilliseconds(body.from).toString({
            smallestUnit: "millisecond",
          }),
          to: Temporal.Instant.fromEpochMilliseconds(body.to).toString({
            smallestUnit: "millisecond",
          }),
        },
      },
    };
  }
}
