/**
 * @vitest-environment node
 * @see specs/ai-gateway/realtime-sessions.feature
 * One reconcile intent over the derived chain: model-provider's keys, the vendor channel and
 * the sessions.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  ModelProviderCustomKeysMissingError,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { GatewaySpendConfirmation } from "../../app/gateway.members.ts";
import { MemoryElevenLabsConversationChannel } from "../../channels/memory/memory.elevenlabs-conversation.channel.ts";
import { MemoryGatewayRealtimeSessionRepository } from "../../repositories/memory/memory.gateway-realtime-session.repository.ts";
import { GatewayElevenLabsCredentialService } from "../../services/gateway-elevenlabs-credential.service.ts";
import {
  GatewayRealtimeSessionReconciliationService,
  realtimeSessionReconciliationConfig,
} from "../../services/gateway-realtime-session-reconciliation.service.ts";
import { GatewayRealtimeSessionSweepService } from "../../services/gateway-realtime-session-sweep.service.ts";
import { GatewayRealtimeSessionService } from "../../services/gateway-realtime-session.service.ts";
import { ModelCatalogGatewaySpendRatingService } from "../../services/model-catalog-gateway-spend-rating.service.ts";
import { runGatewayRealtimeSessionReconcile } from "../gateway-realtime-session-reconcile.intent.ts";
import type { ConfirmSpendCommandData } from "../gateway-spend-commands.process.ts";

const PROVIDER_ID = "provider-1";
const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";

class RecordingSpendConfirmation implements GatewaySpendConfirmation {
  readonly sent: ConfirmSpendCommandData[] = [];

  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    this.sent.push(data);
  }
}

async function reconcileOnce(modelProviders: Pick<ModelProviderApi, "getCustomKeys">) {
  const sessions = MemoryGatewayRealtimeSessionRepository.create();
  const conversations = MemoryElevenLabsConversationChannel.create();
  const spendConfirmation = new RecordingSpendConfirmation();
  const collaborators = {
    sessions,
    spendRating: ModelCatalogGatewaySpendRatingService.create(),
    spendConfirmation,
  };
  const operations = GatewayRealtimeSessionService.create();
  await operations.reserveRealtimeSession({
    sessionId: "session-1",
    projectId: PROJECT_ID,
    organizationId: "organization-1",
    virtualKeyId: "key-1",
    modelProviderId: PROVIDER_ID,
    vendor: "elevenlabs",
    model: "convai",
    collaborators,
  });
  await operations.correlateRealtimeSession({
    sessionId: "session-1",
    projectId: PROJECT_ID,
    vendorConversationId: CONVERSATION_ID,
    collaborators,
  });
  conversations.seedReport({
    conversationId: CONVERSATION_ID,
    report: { status: "done", metadata: { call_duration_secs: 3 } },
  });
  const reconciliation = GatewayRealtimeSessionReconciliationService.create({
    repository: GatewayRealtimeSessionSweepService.create(collaborators),
    credentials: GatewayElevenLabsCredentialService.create({ modelProviders }),
    conversations,
    logger: { warn: () => void 0, info: () => void 0, error: () => void 0 },
    config: realtimeSessionReconciliationConfig,
    clock: { now: () => nowInstant().add({ minutes: 3 }) },
  });
  const pruned: string[] = [];
  await runGatewayRealtimeSessionReconcile({
    reconcile: () => reconciliation.poll(),
    deleteDispatchedBefore: async ({ processName }) => {
      pruned.push(processName);
      return 0;
    },
  })();

  return { sessions, conversations, spendConfirmation, pruned };
}

describe("the voice reconcile intent", () => {
  describe("when model-provider holds the ElevenLabs API key", () => {
    it("closes the session and confirms its spend from the vendor's duration", async () => {
      const { sessions, spendConfirmation, pruned } = await reconcileOnce(
        createApiFixture<ModelProviderApi>({
          getCustomKeys: async ({ modelProviderId }) => ({
            id: modelProviderId,
            provider: "elevenlabs",
            organizationId: "organization-1",
            customKeys: { ELEVENLABS_API_KEY: "xi-invented" },
          }),
        }),
      );

      expect(sessions.rows.get("session-1")?.status).toBe("CLOSED");
      expect(spendConfirmation.sent).toHaveLength(1);
      expect(spendConfirmation.sent[0]?.usage).toMatchObject({ audio_ms: 3000 });
      expect(pruned).toEqual(["gatewayRealtimeSessionReconcile"]);
    });
  });

  describe("when the provider row stores no keys", () => {
    /** @scenario "A provider with no readable voice key leaves its sessions open" */
    it("leaves the session open and never asks the vendor", async () => {
      const { sessions, conversations, spendConfirmation } = await reconcileOnce(
        createApiFixture<ModelProviderApi>({
          getCustomKeys: async () => {
            throw new ModelProviderCustomKeysMissingError();
          },
        }),
      );

      expect(sessions.rows.get("session-1")?.status).toBe("OPEN");
      expect(conversations.asked).toEqual([]);
      expect(spendConfirmation.sent).toEqual([]);
    });
  });
});
