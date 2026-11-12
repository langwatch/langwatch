import type { AgentApi } from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
/** @see specs voice-agents-v1.feature: a finished call records one trace per exchange. */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { RecordSpanCommandData, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryVoiceRecordingChannel } from "../../channels/memory/memory.voice-recording.channel.ts";
import { VoiceSessionService } from "../../features/voice/services/voice-session.service.ts";
import { signVoiceSessionToken } from "../../rules/voice-session-token.rules.ts";
import type { ScenarioService } from "../scenario.service.ts";

const SECRET = "voice-test-secret";

function composeWithTraceCollector({
  runCap = async () => {},
}: { runCap?: (input: { projectId: string }) => Promise<void> } = {}) {
  const recorded: RecordSpanCommandData[] = [];
  const service = VoiceSessionService.compose({
    peers: {
      agents: createApiFixture<AgentApi>({}),
      auditLog: createApiFixture<AuditLogApi>({}),
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      gateway: createApiFixture<GatewayApi>({}),
      modelProviders: createApiFixture<ModelProviderApi>({
        findAllAccessibleForProject: async () => [],
      }),
      traces: createApiFixture<TraceApi>({
        recordSpan: async (span) => {
          recorded.push(span);
        },
      }),
    },
    scenarios: createApiFixture<ScenarioService>({}),
    simulations: createApiFixture<SimulationService>({}),
    runCap: { assertCountedRunAllowed: async () => {}, assertRunAllowed: runCap },
    signingSecret: SECRET,
    voicePublicBaseUrl: undefined,
    voiceCallMaxSeconds: undefined,
    allowLoopbackVoiceProviders: false,
    recordings: MemoryVoiceRecordingChannel.create(),
  });
  return { service, recorded };
}

describe("VoiceSessionService.compose", () => {
  describe("given a finished drawer call with two exchanges", () => {
    it("records one root span per exchange through TraceApi.recordSpan", async () => {
      const { service, recorded } = composeWithTraceCollector();
      const sessionToken = signVoiceSessionToken({
        secret: SECRET,
        payload: {
          sessionId: "session_1",
          projectId: "project_1",
          agentId: "agent_1",
          agentExternalId: "vendor_agent",
          transport: "elevenlabs_convai",
          exp: Date.now() + 60_000,
        },
      });

      await service.finish({
        projectId: "project_1",
        sessionToken,
        transcript: [
          { role: "caller", text: "Hi" },
          { role: "agent", text: "Hello" },
          { role: "caller", text: "Bye" },
          { role: "agent", text: "Goodbye" },
        ],
        startedAt: 1_000,
        endedAt: 5_000,
        isCutAtLimit: false,
        userId: "user_1",
      });

      expect(recorded).toHaveLength(2);
      expect(recorded.map((span) => span.tenantId)).toEqual(["project_1", "project_1"]);
      expect(recorded[0]?.span.name).toBe("Voice Call Turn");
      expect(recorded[0]?.instrumentationScope).toEqual({ name: "langwatch.voice", version: null });
      expect(recorded[0]?.span.attributes).toContainEqual({
        key: "gen_ai.input.messages",
        value: { stringValue: JSON.stringify([{ role: "user", content: "Hi" }]) },
      });
    });
  });

  describe("given an organization past its run cap", () => {
    const refused = new Error("scenario run cap reached");

    it("refuses to open a scenario call", async () => {
      const { service } = composeWithTraceCollector({
        runCap: async () => {
          throw refused;
        },
      });

      await expect(
        service.mint({
          projectId: "project_1",
          transport: "elevenlabs_convai",
          agentId: "vendor_agent",
          scenarioId: "scenario_1",
          userId: "user_1",
        }),
      ).rejects.toBe(refused);
    });

    it("leaves a drawer call to open without asking the cap", async () => {
      const asked: string[] = [];
      const { service } = composeWithTraceCollector({
        runCap: async ({ projectId }) => {
          asked.push(projectId);
          throw refused;
        },
      });

      await service
        .mint({
          projectId: "project_1",
          transport: "elevenlabs_convai",
          agentId: "vendor_agent",
          userId: "user_1",
        })
        .catch(() => undefined);

      expect(asked).toEqual([]);
    });
  });
});
