/**
 * ElevenLabs post-call webhook.
 *
 * Surface:
 *   POST /api/elevenlabs/webhook/:modelProviderId
 *
 * Customers do not paste this URL anywhere. The documented one is on the
 * gateway, `POST /v1/convai/webhook/{model_provider_id}`, which relays the
 * raw bytes here and returns whatever this answers. A webhook has to be
 * reachable from the vendor's network, the gateway is public by design, and
 * this app is the admin surface that a self-hosted customer often keeps
 * behind a VPN. Verification stays here because the per-tenant secret is in
 * this database.
 *
 * The route is unchanged by the move. It is the relay's target, and a
 * deployment that already points ElevenLabs at it keeps working — which is
 * why the whole HMAC, its tolerance window and every acknowledgement below
 * are transcribed rather than reshaped.
 *
 * A brokered ElevenLabs conversation reports nothing over its socket. Cost
 * and duration arrive afterwards, on this webhook, and it is the only path by
 * which a voice call reaches billing (ADR-097).
 *
 * The tenant is the path parameter, verified against the provider row it
 * names. That keeps the signature check one HMAC computation instead of a
 * walk over every configured provider, and an id that names no configured
 * webhook answers 404 so the ids cannot be probed.
 *
 * Every delivery this handler can parse is acknowledged, and that is not
 * politeness. A retry is not guaranteed: ElevenLabs does not retry every
 * failed delivery, and retries are off for HIPAA workflows. The webhook is
 * also disabled once it has 10 or more consecutive failures and its last
 * success is older than 7 days or never happened, which would stop delivery
 * for every tenant on the endpoint.
 *
 * That is why this webhook is an optimisation and not the billing path. The
 * Gateway reconciliation worker asks the vendor for the same numbers
 * on a schedule, so a lost or rejected delivery costs latency rather than
 * money, and a webhook that was never registered at all still bills correctly.
 * An unmatched call is not lost either: its spend record settles as
 * cost-unknown at the grace, visibly, and a later report supersedes it.
 *
 * Spec: specs/ai-gateway/realtime-sessions.feature.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { createHmac, timingSafeEqual } from "crypto";
import type { Context } from "hono";
import { z } from "zod";

import {
  getElevenLabsWebhookSecret,
  type ElevenLabsCredentialCollaborators,
} from "../../services/gateway-elevenlabs-credential.service";
import {
  closeAndConfirmRealtimeSession,
  matchRealtimeSession,
  type GatewayRealtimeSessionCollaborators,
} from "../../services/gateway-realtime-session.service";

const logger = createLogger("langwatch:api:elevenlabs");

const WEBHOOK_PUBLIC_REASON =
  "ElevenLabs post-call webhook delivery URL — the vendor's own delivery " +
  "target, so public by protocol; every payload is verified in-handler by " +
  "its ElevenLabs-Signature HMAC against the secret stored on the provider " +
  "row the path names.";

/**
 * How far out of date a delivery's own timestamp may be.
 *
 * The timestamp is inside the signed payload, so an attacker cannot move it
 * without breaking the signature. Bounding it stops a captured delivery from
 * being replayed later; thirty minutes is well past any delivery retry the
 * vendor performs.
 */
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

/**
 * The one event type this handler acts on.
 *
 * A workspace can enable other post-call events in its ElevenLabs dashboard.
 * `post_call_audio` and `call_initiation_failure` both carry a
 * `data.conversation_id` for the same conversation and no `data.metadata`, so
 * without this check they match the open session and close it at zero.
 */
const BILLABLE_EVENT_TYPE = "post_call_transcription";

/**
 * The fields this handler reads. Everything else in the payload, including
 * the transcript and the analysis, is deliberately not read: the platform
 * bills a call, it does not store what was said on it.
 */
const postCallSchema = z.object({
  type: z.string().optional(),
  event_timestamp: z.number().optional(),
  data: z
    .object({
      agent_id: z.string().optional(),
      conversation_id: z.string().optional(),
      metadata: z
        .object({
          start_time_unix_secs: z.number().optional(),
          call_duration_secs: z.number().optional(),
          // `cost` is ElevenLabs credits and `cost_fiat` is money. A
          // three-second call reports cost 24 and cost_fiat 0.0044, so
          // reading the wrong one is off by three orders of magnitude.
          // Both are kept as evidence; neither is what the session bills
          // on, which is duration.
          cost: z.number().optional(),
          cost_fiat: z.number().optional(),
        })
        .passthrough()
        .optional(),
      conversation_initiation_client_data: z
        .object({
          dynamic_variables: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

/**
 * Verifies the `ElevenLabs-Signature: t=<unix>,v0=<hex>` header.
 *
 * The signed payload is the timestamp, a dot, then the raw request bytes, so
 * the body must be read as text and never re-serialized: a JSON round trip
 * reorders keys and the signature stops matching.
 */
export function verifyElevenLabsSignature(params: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  nowSeconds?: number;
}): boolean {
  if (!params.secret) return false;
  const parsed = parseSignatureHeader(params.header);
  if (!parsed) return false;

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.sentAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", params.secret)
    .update(`${parsed.timestamp}.${params.rawBody}`)
    .digest("hex");
  const a = Buffer.from(parsed.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The `t=` and `v0=` parts of the header, or null when either is missing. */
function parseSignatureHeader(
  header: string | undefined,
): { timestamp: string; sentAt: number; signature: string } | null {
  const parts = new Map(
    (header ?? "").split(",").map((part) => {
      const [name, value] = part.trim().split("=", 2);
      return [name ?? "", value ?? ""] as const;
    }),
  );
  const timestamp = parts.get("t") ?? "";
  const signature = parts.get("v0") ?? "";
  const sentAt = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(sentAt)) return null;
  return { timestamp, sentAt, signature };
}

/**
 * Reads the LangWatch session id the mint echoed into the conversation's own
 * variables. Used only when the delivery carries no conversation id we
 * already recorded.
 */
function echoedSessionId(payload: z.infer<typeof postCallSchema>): string | undefined {
  const value =
    payload.data?.conversation_initiation_client_data?.dynamic_variables?.lw_session_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Everything the delivery reaches that it does not own. */
export type ElevenLabsWebhookRestPorts = Readonly<{
  /** Reads the per-tenant webhook secret off the provider row the path names. */
  credentials: ElevenLabsCredentialCollaborators;
  /** Matches the report to its open session and confirms that session's spend. */
  sessions: GatewayRealtimeSessionCollaborators;
}>;

async function handleElevenLabsWebhook(
  c: Context,
  ports: ElevenLabsWebhookRestPorts,
): Promise<Response> {
  // Typed as optional because the generic Context does not know this route's
  // parameters. An empty id resolves no provider, so it answers 404 with the
  // rest of them.
  const modelProviderId = c.req.param("modelProviderId") ?? "";
  const configured = await getElevenLabsWebhookSecret({
    modelProviderId,
    collaborators: ports.credentials,
  });
  if (!configured) {
    // 404 rather than 401: an id with no webhook configured must look the
    // same as an id that does not exist, or the ids are enumerable.
    return c.json({ error: "Webhook not configured" }, { status: 404 });
  }

  // The RAW bytes: the HMAC is over exactly what the vendor sent.
  const rawBody = await c.req.text();
  if (
    !verifyElevenLabsSignature({
      rawBody,
      header:
        c.req.header("elevenlabs-signature") ?? c.req.header("ElevenLabs-Signature"),
      secret: configured.secret,
    })
  ) {
    return c.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: z.infer<typeof postCallSchema>;
  try {
    payload = postCallSchema.parse(JSON.parse(rawBody));
  } catch {
    return c.json({ error: "Invalid payload" }, { status: 400 });
  }

  // The type must be present AND billable. An absent type is not a
  // transcription report either: real deliveries always carry one, so a
  // payload without it is malformed, and letting it through would match a
  // session and settle it from fields it does not have.
  //
  // Acknowledged, not refused. A retry is not guaranteed, and ten consecutive
  // failures disable the webhook, so answering non-2xx to an event this
  // handler does not act on risks stopping delivery of the one it does act
  // on, for every tenant sharing the endpoint.
  if (payload.type !== BILLABLE_EVENT_TYPE) {
    return c.json({ received: true });
  }

  try {
    await applyPostCallReport({
      payload,
      modelProviderId,
      organizationId: configured.organizationId,
      sessions: ports.sessions,
    });
  } catch (err) {
    logger.warn(
      { err, modelProviderId },
      "an ElevenLabs post-call report could not be applied; its session settles as cost-unknown",
    );
  }
  return c.json({ received: true });
}

/** Matches the report to its session and confirms that session's spend. */
async function applyPostCallReport(params: {
  payload: z.infer<typeof postCallSchema>;
  modelProviderId: string;
  organizationId: string;
  sessions: GatewayRealtimeSessionCollaborators;
}): Promise<void> {
  const data = params.payload.data;

  // No positive duration means no quantity to confirm. A confirmed spend
  // record of zero is one the fold never downgrades, so no later report could
  // correct it. That covers an absent duration, a negative one, and one that
  // rounds to zero: a call the vendor timed at under half a second is an
  // anomaly worth seeing rather than a call that cost nothing. Returning here
  // leaves the admission to settle as cost-unknown on its grace, visibly.
  const reportedSecs = data?.metadata?.call_duration_secs;
  if (
    typeof reportedSecs !== "number" ||
    !Number.isFinite(reportedSecs) ||
    Math.round(reportedSecs) < 1
  ) {
    logger.warn(
      {
        modelProviderId: params.modelProviderId,
        conversationId: data?.conversation_id,
      },
      "an ElevenLabs post-call report carried no call duration; its session settles as cost-unknown",
    );
    return;
  }

  const startedAtSecs = data?.metadata?.start_time_unix_secs;
  const session = await matchRealtimeSession({
    vendor: "elevenlabs",
    organizationId: params.organizationId,
    modelProviderId: params.modelProviderId,
    vendorConversationId: data?.conversation_id,
    echoedSessionId: echoedSessionId(params.payload),
    callStartedAt: startedAtSecs ? new Date(startedAtSecs * 1000) : undefined,
    collaborators: params.sessions,
  });
  if (!session) return;

  // The vendor prices a conversation by duration, so duration is the
  // quantity. It arrives in whole seconds and every quantity on the spend
  // wire is an integer, so it becomes milliseconds here, once. The guard
  // above already proved this rounds to 1 or more.
  const durationSecs = Math.round(reportedSecs);
  await closeAndConfirmRealtimeSession({
    session,
    usage: { audio_ms: durationSecs * 1000 },
    // The whole metadata block, kept as the vendor's own record of the call.
    // Nothing prices from it: the session bills on duration at the catalog
    // rate. If a comparison against the vendor's figure is ever added, the
    // money field is `cost_fiat`. `cost` is ElevenLabs credits.
    vendorCostRaw: data?.metadata ?? null,
    durationMs: durationSecs * 1000,
    reason: "post-call report",
    collaborators: params.sessions,
  });
}

/** `/api/elevenlabs/webhook/:modelProviderId`, bound to one process. */
export function createElevenLabsWebhookRestApp(options: {
  security: AppRestSecurity;
  ports: ElevenLabsWebhookRestPorts;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/api" });
  secured
    .access(publicEndpoint(WEBHOOK_PUBLIC_REASON))
    .post("/elevenlabs/webhook/:modelProviderId", (c) =>
      handleElevenLabsWebhook(c, options.ports),
    );
  return secured.hono;
}
