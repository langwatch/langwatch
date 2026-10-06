import {
  canonicalBaseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import {
  webhookSpendReplayBodySchema,
  webhookSpendReplayResponseSchema,
  type WebhookSpendReplayBody,
  type WebhookSpendReplayResponse,
} from "@langwatch/webhook-contract";

/**
 * @see ADR-072 (pull gates under the same plan flag as push)
 * The spend replay on `/api/gateway/v1`, answered by webhook because it reads only webhook's
 * endpoints, emitted log and delivery stream. Path, body, answer and permission are main's.
 */

/** What the replay route reaches: the parsed body in, the replay's receipt out. */
export interface WebhookSpendReplayDoorApi {
  answerSpendReplay(
    input: Readonly<{ organizationId: string; body: WebhookSpendReplayBody }>,
  ): Promise<WebhookSpendReplayResponse>;
}

export const WebhookSpendReplayApi = moduleApi<WebhookSpendReplayDoorApi>()("webhook");

const REPLAY_DESCRIPTION =
  "Re-delivers the window's spend envelopes to ONE endpoint through the " +
  "normal delivery path (per-endpoint stream, retry ladder, delivery log), " +
  "honoring the endpoint's event subscriptions. Envelope ids are UNCHANGED: " +
  "your consumer's event-id dedup decides what a redelivery means. Mind your " +
  "downstream billing system's finite dedup window (Metronome 34 days, " +
  "Stripe 24h+): replaying older than that window can double-bill on your " +
  "side, so prefer pull-and-diff for old ranges. The window is capped at 7 " +
  "days and 10,000 envelopes per call; both caps are checked before any " +
  "delivery is queued, so a refused replay ships nothing.";

export const webhookSpendReplayRest = defineRestRouter(WebhookSpendReplayApi)
  .withNamespace("gateway-spend")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // Shared with gateway's reconciliation reads rather than owned: the route answers
  // exactly where it answers on main, with no `/api/v1` twin beside it.
  .withAddressing("literal", { v1Twin: false })

  .post("/api/gateway/v1/spend-events/replay", "replayGatewaySpendEvents")
  .withInput(webhookSpendReplayBodySchema)
  .withPermission("gatewaySpend:manage")
  .withOutput(webhookSpendReplayResponseSchema)
  .withEntitlement("webhook_endpoints")
  .withDocs({
    operationId: "postApiGatewayV1SpendEventsReplay",
    tags: ["Gateway Spend"],
    summary: "Replay spend events to an endpoint",
    description: REPLAY_DESCRIPTION,
    responses: canonicalBaseResponses,
  })
  .handle(({ app, input, scope }) =>
    app.answerSpendReplay({ organizationId: scope.id, body: input }),
  )

  .build();
