/**
 * The ElevenLabs callback through the Gateway composer, installer, API REST
 * runtime, and production mount.
 * @see specs/ai-gateway/realtime-sessions.feature
 */
// @vitest-environment node
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ELEVENLABS_WEBHOOK_SECRET_KEY,
  GatewaySpendConfirmation,
  type ConfirmSpendCommandData,
} from "@langwatch/gateway-server";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import {
  composeGatewayElevenLabsWebhook,
  installApiGateway,
} from "../../features/gateway/gateway.composition.ts";
import { mountGatewayElevenLabsWebhookRest } from "../../features/gateway/gateway-rest.mount.ts";

const CREDENTIALS_SECRET = "b".repeat(64);
const WEBHOOK_SECRET = "wsec-elevenlabs";
const MODEL_PROVIDER_ID = "provider-1";
const ORGANIZATION_ID = "organization-1";
const SESSION_ID = "session-1";
const MINTED_AT = new Date("2026-09-01T10:00:00.000Z");

type HarnessOptions = Readonly<{
  providerExists?: boolean;
  sessionExists?: boolean;
}>;

async function webhookHarness(options: HarnessOptions = {}) {
  const confirmations: ConfirmSpendCommandData[] = [];
  const closed: Array<Record<string, unknown>> = [];
  const providerExists = options.providerExists ?? true;
  const sessionExists = options.sessionExists ?? true;
  const prisma = {
    modelProvider: {
      findUnique: vi.fn(async () =>
        providerExists
          ? {
              provider: "elevenlabs",
              organizationId: ORGANIZATION_ID,
              customKeys: { [ELEVENLABS_WEBHOOK_SECRET_KEY]: WEBHOOK_SECRET },
            }
          : null,
      ),
    },
    gatewayRealtimeSession: {
      findFirst: vi.fn(async () =>
        sessionExists
          ? {
              id: SESSION_ID,
              projectId: "project-1",
              organizationId: ORGANIZATION_ID,
              virtualKeyId: "virtual-key-1",
              modelProviderId: MODEL_PROVIDER_ID,
              vendor: "elevenlabs",
              agentId: null,
              model: "elevenlabs/eleven-turbo-v2",
              requestedModel: null,
              vendorConversationId: "conversation-1",
              status: "OPEN",
              mintedAt: MINTED_AT,
              closedAt: null,
              closeReason: null,
              traceId: "trace-1",
              vendorCostRaw: null,
              createdAt: MINTED_AT,
              updatedAt: MINTED_AT,
            }
          : null,
      ),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        closed.push(args);
        return { count: 1 };
      }),
    },
  } as PrismaClient;

  class RecordingSpendConfirmation extends GatewaySpendConfirmation {
    async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
      confirmations.push(data);
    }
  }

  const elevenLabsWebhook = composeGatewayElevenLabsWebhook({
    prisma,
    encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
    spendConfirmation: new RecordingSpendConfirmation(),
  });
  const gateway = await installApiGateway({
    infrastructure: void 0,
    peers: void 0,
    clickhouse: null,
    virtualKeyPepper: void 0,
    elevenLabsWebhook,
  });
  const service = gateway.restServices.elevenLabsWebhook;
  if (!service) throw new Error("The webhook infrastructure did not install its REST service");

  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("The public webhook must not ask for a project credential");
    },
    organizationCredential: () => {
      throw new Error("The public webhook must not ask for an organization credential");
    },
    organizationIdentity: () => {
      throw new Error("The public webhook must not ask for an organization identity");
    },
    routeAuthorization: () => {
      throw new Error("The public webhook must not ask for a route permission");
    },
    errors,
  });
  const app = mountGatewayElevenLabsWebhookRest(runtime, service);

  return { app, confirmations, closed };
}

function postCallBody(input: { durationSecs: number }): string {
  return JSON.stringify({
    type: "post_call_transcription",
    event_timestamp: Math.floor(Date.now() / 1000),
    data: {
      agent_id: "agent-1",
      conversation_id: "conversation-1",
      metadata: {
        start_time_unix_secs: Math.floor(MINTED_AT.getTime() / 1000),
        call_duration_secs: input.durationSecs,
        cost: 24,
        cost_fiat: 0.0044,
      },
    },
  });
}

function signedDelivery(body: string, secret = WEBHOOK_SECRET): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  return new Request(`http://api.test/api/elevenlabs/webhook/${MODEL_PROVIDER_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "elevenlabs-signature": `t=${timestamp},v0=${signature}`,
    },
    body,
  });
}

describe("given a process that composed the spend confirmation path", () => {
  describe("when ElevenLabs delivers a signed post-call report", () => {
    it("settles the matched session through this process's rating seam", async () => {
      const harness = await webhookHarness();
      const response = await harness.app.request(
        signedDelivery(postCallBody({ durationSecs: 12 })),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
      expect(harness.confirmations).toHaveLength(1);
      const confirmation = harness.confirmations[0];
      if (!confirmation) throw new Error("The signed report did not confirm spend");
      expect(confirmation).toMatchObject({
        gateway_request_id: SESSION_ID,
        tenantId: "project-1",
        model_provider_id: MODEL_PROVIDER_ID,
        organization_id: ORGANIZATION_ID,
        request_type: "realtime_session",
        duration_ms: 12_000,
        usage: { audio_ms: 12_000 },
      });
      expect(String(confirmation.rate_version)).toMatch(/^registry@/);
      expect(typeof confirmation.cost_nano_usd).toBe("number");
      expect(harness.closed).toHaveLength(1);
      expect(harness.closed[0]).toMatchObject({
        where: { id: SESSION_ID, projectId: "project-1" },
      });
    });

    /** @scenario "A delivery signed with the wrong secret is refused" */
    it("refuses a delivery whose signature does not match the stored secret", async () => {
      const harness = await webhookHarness();
      const response = await harness.app.request(
        signedDelivery(postCallBody({ durationSecs: 12 }), "wsec-other"),
      );

      expect(response.status).toBe(401);
      expect(harness.confirmations).toHaveLength(0);
      expect(harness.closed).toHaveLength(0);
    });

    it("rejects malformed signed raw bytes before matching a session", async () => {
      const harness = await webhookHarness();
      const response = await harness.app.request(signedDelivery("not-json"));

      expect(response.status).toBe(400);
      expect(harness.confirmations).toHaveLength(0);
      expect(harness.closed).toHaveLength(0);
    });
  });
});

describe("given the provider has no configured webhook", () => {
  it("answers 404 without matching or confirming a session", async () => {
    const harness = await webhookHarness({ providerExists: false });
    const response = await harness.app.request(signedDelivery(postCallBody({ durationSecs: 12 })));

    expect(response.status).toBe(404);
    expect(harness.confirmations).toHaveLength(0);
    expect(harness.closed).toHaveLength(0);
  });
});

describe("given no open session matches the report", () => {
  it("acknowledges the delivery without confirming spend", async () => {
    const harness = await webhookHarness({ sessionExists: false });
    const response = await harness.app.request(signedDelivery(postCallBody({ durationSecs: 12 })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(harness.confirmations).toHaveLength(0);
    expect(harness.closed).toHaveLength(0);
  });
});

describe("given a process that registered no spend pipeline", () => {
  it("does not compose the webhook infrastructure", () => {
    const elevenLabsWebhook = composeGatewayElevenLabsWebhook({
      prisma: createApiFixture<PrismaClient>(),
      encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
      spendConfirmation: void 0,
    });

    expect(elevenLabsWebhook).toBeUndefined();
  });
});
