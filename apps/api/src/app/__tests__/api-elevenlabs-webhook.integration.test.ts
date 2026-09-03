/**
 * The ElevenLabs post-call webhook as this process mounts it, driven over real
 * HTTP.
 *
 * A brokered voice conversation reports nothing over its socket: cost and
 * duration arrive afterwards, on this delivery, and it is the only path by
 * which a voice call reaches billing before the reconciliation worker's
 * scheduled read. The family was moved into `@langwatch/gateway-server` in REST
 * wave 3d and left unmounted for want of the realtime collaborator bag; what is
 * pinned here is that a SIGNED delivery now settles the session through the
 * SAME rating seam and the SAME confirmation the gateway's own booking uses.
 *
 * The signature is computed the way the vendor computes it, over the raw bytes,
 * so the HMAC gate and its tolerance window are really exercised.
 *
 * @see apps/api/src/app/api-gateway-internal-rest.composition.ts
 * @see specs/ai-gateway/realtime-sessions.feature
 */
// @vitest-environment node
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  ELEVENLABS_WEBHOOK_SECRET_KEY,
  GatewaySpendConfirmationPort,
} from "@langwatch/gateway-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { composeApiElevenLabsWebhookRest } from "../api-gateway-internal-rest.composition";
import { ApiRestSecurity } from "../../api-rest.security";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";

/** 32 bytes of hex, which is what the stored-secret cipher refuses anything else for. */
const CREDENTIALS_SECRET = "b".repeat(64);
const WEBHOOK_SECRET = "wsec_elevenlabs";
const MODEL_PROVIDER_ID = "provider-1";
const ORGANIZATION_ID = "organization-1";
const SESSION_ID = "session-1";
const MINTED_AT = new Date("2026-09-01T10:00:00.000Z");

describe("given a process that composed the spend confirmation path", () => {
  describe("when ElevenLabs delivers a signed post-call report", () => {
    it("settles the matched session through this process's rating seam", async () => {
      const harness = webhookHarness();
      const body = postCallBody({ durationSecs: 12 });

      const response = await harness.app.request(signedDelivery(body));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });

      expect(harness.confirmations).toHaveLength(1);
      const confirmation = harness.confirmations[0]!;
      // The session's own id is the spend record's request id, and the
      // quantity is the reported duration in milliseconds.
      expect(confirmation).toMatchObject({
        gateway_request_id: SESSION_ID,
        tenantId: "project-1",
        model_provider_id: MODEL_PROVIDER_ID,
        organization_id: ORGANIZATION_ID,
        request_type: "realtime_session",
        duration_ms: 12_000,
      });
      expect((confirmation.usage as { audio_ms: number }).audio_ms).toBe(12_000);
      // The wire carries quantities and never money, so a rate identity on the
      // confirmation can only have come from the model-catalog rating adapter
      // this composition binds — the same one the drained spend batch prices on.
      expect(String(confirmation.rate_version)).toMatch(/^registry@/);
      expect(typeof confirmation.cost_nano_usd).toBe("number");

      // The row is closed only after the confirmation lands.
      expect(harness.closed).toHaveLength(1);
      expect(harness.closed[0]).toMatchObject({
        where: { id: SESSION_ID, projectId: "project-1" },
      });
    });

    it("refuses a delivery whose signature does not match the stored secret", async () => {
      const harness = webhookHarness();
      const body = postCallBody({ durationSecs: 12 });

      const response = await harness.app.request(
        new Request(`http://api.test/api/elevenlabs/webhook/${MODEL_PROVIDER_ID}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ElevenLabs-Signature": `t=${Math.floor(Date.now() / 1000)},v0=${"0".repeat(64)}`,
          },
          body,
        }),
      );

      expect(response.status).toBe(401);
      expect(harness.confirmations).toHaveLength(0);
    });
  });
});

describe("given a process that registered no spend pipeline", () => {
  describe("when ElevenLabs delivers a post-call report", () => {
    it("does not mount the webhook at all", () => {
      const app = composeApiElevenLabsWebhookRest({
        security: restSecurity(),
        prisma: {} as unknown as PrismaClient,
        encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
        spendConfirmation: undefined,
      });

      // Left off rather than acknowledging a delivery it cannot bill: the
      // vendor sends one report, and an ack consumes it.
      expect(app).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------

function restSecurity() {
  return ApiRestSecurity.create({
    apiKeys: {} as unknown as ApiKeyService,
    authz: {} as unknown as AuthzService,
    organizations: {} as unknown as OrganizationService,
    observability: ApiRestObservabilityComposition.create(),
  });
}

/**
 * The family, built the way the process builds it, over row doubles.
 *
 * The doubles sit at the DATABASE rather than at the services, so the credential
 * read, the session match and the close-after-confirm ordering are all really
 * exercised.
 */
function webhookHarness() {
  const confirmations: Array<Record<string, unknown>> = [];
  const closed: Array<Record<string, unknown>> = [];

  const prisma = {
    modelProvider: {
      findUnique: vi.fn(async () => ({
        provider: "elevenlabs",
        organizationId: ORGANIZATION_ID,
        // A plaintext key bag, which is what a row written before the cipher
        // looks like and what the lenient reader answers unchanged.
        customKeys: { [ELEVENLABS_WEBHOOK_SECRET_KEY]: WEBHOOK_SECRET },
      })),
    },
    gatewayRealtimeSession: {
      findFirst: vi.fn(async () => ({
        id: SESSION_ID,
        projectId: "project-1",
        organizationId: ORGANIZATION_ID,
        virtualKeyId: "vk_1",
        modelProviderId: MODEL_PROVIDER_ID,
        vendor: "elevenlabs",
        model: "elevenlabs/eleven_turbo_v2",
        status: "OPEN",
        mintedAt: MINTED_AT,
        traceId: "trace-1",
      })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        closed.push(args);
        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;

  class RecordingSpendConfirmation extends GatewaySpendConfirmationPort {
    async confirmSpend(data: Record<string, unknown>): Promise<void> {
      confirmations.push(data);
    }
  }

  const app = composeApiElevenLabsWebhookRest({
    security: restSecurity(),
    prisma,
    encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
    spendConfirmation: new RecordingSpendConfirmation() as never,
  });
  if (!app) throw new Error("the composition refused a process that holds both halves");

  return { app, confirmations, closed };
}

/** The vendor's post-call transcription event, in its own wire shape. */
function postCallBody(input: { durationSecs: number }): string {
  return JSON.stringify({
    type: "post_call_transcription",
    event_timestamp: Math.floor(Date.now() / 1000),
    data: {
      agent_id: "agent-1",
      conversation_id: "conv-1",
      metadata: {
        start_time_unix_secs: Math.floor(MINTED_AT.getTime() / 1000),
        call_duration_secs: input.durationSecs,
        cost: 24,
        cost_fiat: 0.0044,
      },
    },
  });
}

/** A delivery signed exactly the way ElevenLabs signs one. */
function signedDelivery(body: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return new Request(`http://api.test/api/elevenlabs/webhook/${MODEL_PROVIDER_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ElevenLabs-Signature": `t=${timestamp},v0=${signature}`,
    },
    body,
  });
}
