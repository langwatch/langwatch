import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { GatewayElevenLabsWebhookAnswer } from "@langwatch/gateway-contract";
import {
  GatewayElevenLabsCredentialService,
  type ElevenLabsCredentialCollaborators,
} from "./gateway-elevenlabs-credential.service.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionCollaborators,
} from "./gateway-realtime-session.service.ts";

const logger = createLogger("langwatch:api:elevenlabs");
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;
const BILLABLE_EVENT_TYPE = "post_call_transcription";

const postCallSchema = z.object({
  type: z.string().optional(),
  data: z
    .object({
      conversation_id: z.string().optional(),
      metadata: z
        .object({
          start_time_unix_secs: z.number().optional(),
          call_duration_secs: z.number().optional(),
          cost: z.number().optional(),
          cost_fiat: z.number().optional(),
        })
        .passthrough()
        .optional(),
      conversation_initiation_client_data: z
        .object({ dynamic_variables: z.record(z.string(), z.unknown()).optional() })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

type PostCall = z.infer<typeof postCallSchema>;

export type ElevenLabsWebhookCollaborators = Readonly<{
  credentials: ElevenLabsCredentialCollaborators;
  sessions: GatewayRealtimeSessionCollaborators;
}>;

export class GatewayElevenLabsWebhookService {
  readonly #credentials: GatewayElevenLabsCredentialService;
  readonly #sessions: GatewayRealtimeSessionService;
  readonly #sessionCollaborators: GatewayRealtimeSessionCollaborators;

  static create(collaborators: ElevenLabsWebhookCollaborators): GatewayElevenLabsWebhookService {
    return new GatewayElevenLabsWebhookService(collaborators);
  }

  static verifySignature(input: {
    rawBody: string;
    header: string | undefined;
    secret: string;
    nowSeconds?: number;
  }): boolean {
    if (!input.secret) return false;
    const parsed = findSignatureHeader(input.header);
    if (!parsed) return false;

    const now = input.nowSeconds ?? Math.floor(nowInstant().epochMilliseconds / 1000);
    if (Math.abs(now - parsed.sentAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const expected = createHmac("sha256", input.secret)
      .update(`${parsed.timestamp}.${input.rawBody}`)
      .digest("hex");
    const presented = Buffer.from(parsed.signature);
    const calculated = Buffer.from(expected);
    return presented.length === calculated.length && timingSafeEqual(presented, calculated);
  }

  private constructor(collaborators: ElevenLabsWebhookCollaborators) {
    this.#credentials = GatewayElevenLabsCredentialService.create(collaborators.credentials);
    this.#sessions = GatewayRealtimeSessionService.create();
    this.#sessionCollaborators = collaborators.sessions;
  }

  async receive(input: {
    modelProviderId: string;
    rawBody: string;
    signature: string | undefined;
  }): Promise<GatewayElevenLabsWebhookAnswer> {
    const configured = await this.#credentials.tryGetWebhookSecret({
      modelProviderId: input.modelProviderId,
    });
    if (!configured) return { status: 404, body: { error: "Webhook not configured" } };

    if (
      !GatewayElevenLabsWebhookService.verifySignature({
        rawBody: input.rawBody,
        header: input.signature,
        secret: configured.secret,
      })
    ) {
      return { status: 401, body: { error: "Invalid signature" } };
    }

    const parsed = findPayload(input.rawBody);
    if (!parsed) return { status: 400, body: { error: "Invalid payload" } };
    if (parsed.type !== BILLABLE_EVENT_TYPE) return { status: 200, body: { received: true } };

    try {
      await this.applyReport(parsed, input.modelProviderId, configured.organizationId);
    } catch (error) {
      logger.warn(
        { error, modelProviderId: input.modelProviderId },
        "an ElevenLabs post-call report could not be applied; its session settles as cost-unknown",
      );
    }

    return { status: 200, body: { received: true } };
  }

  private async applyReport(
    payload: PostCall,
    modelProviderId: string,
    organizationId: string,
  ): Promise<void> {
    const reportedSeconds = payload.data?.metadata?.call_duration_secs;
    const durationMissing =
      typeof reportedSeconds !== "number" ||
      !Number.isFinite(reportedSeconds) ||
      Math.round(reportedSeconds) < 1;
    if (durationMissing) {
      logger.warn(
        { modelProviderId, conversationId: payload.data?.conversation_id },
        "an ElevenLabs post-call report carried no call duration; its session settles as cost-unknown",
      );
      return;
    }

    const startedAtSeconds = payload.data?.metadata?.start_time_unix_secs;
    const session = await this.#sessions.tryMatchRealtimeSession({
      vendor: "elevenlabs",
      organizationId,
      modelProviderId,
      vendorConversationId: payload.data?.conversation_id,
      echoedSessionId: findEchoedSessionId(payload),
      callStartedAt: startedAtSeconds
        ? Temporal.Instant.fromEpochMilliseconds(startedAtSeconds * 1000)
        : undefined,
      collaborators: this.#sessionCollaborators,
    });
    if (!session) return;

    const durationSeconds = Math.round(reportedSeconds);
    await this.#sessions.closeAndConfirmRealtimeSession({
      session,
      usage: { audio_ms: durationSeconds * 1000 },
      vendorCostRaw: payload.data?.metadata ?? null,
      durationMs: durationSeconds * 1000,
      reason: "post-call report",
      collaborators: this.#sessionCollaborators,
    });
  }
}

function findSignatureHeader(
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
  return timestamp && signature && Number.isFinite(sentAt)
    ? { timestamp, sentAt, signature }
    : null;
}

function findPayload(rawBody: string): PostCall | null {
  try {
    return postCallSchema.parse(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

function findEchoedSessionId(payload: PostCall): string | undefined {
  const value = payload.data?.conversation_initiation_client_data?.dynamic_variables?.lw_session_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
