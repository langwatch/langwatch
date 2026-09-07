/**
 * @vitest-environment node
 * @unit
 *
 * The voice "Talk to it" HTTP door, driven directly through the Hono app. The
 * auth boundary, the provider-key lookup, the run store and the transport are
 * mocked so these tests exercise only the route's own decisions: who may mint
 * and finish a session, and that a finish cannot be pointed at a conversation
 * the session was not minted for.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));

const probeProjectPermission = vi.fn();
vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeProjectPermission: (...args: unknown[]) =>
    probeProjectPermission(...args),
}));

const findElevenLabsProviderForProject = vi.fn();
const getElevenLabsApiCredential = vi.fn();
vi.mock("~/server/gateway/elevenLabsCredential.service", () => ({
  findElevenLabsProviderForProject: (...args: unknown[]) =>
    findElevenLabsProviderForProject(...args),
  getElevenLabsApiCredential: (...args: unknown[]) =>
    getElevenLabsApiCredential(...args),
}));

const getScenarioRunData = vi.fn();
const appStub = {
  simulations: {
    runs: { getScenarioRunData: (...a: unknown[]) => getScenarioRunData(...a) },
  },
};
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => appStub,
  // The secured-app's appContextMiddleware calls tryGetApp; null makes it skip
  // injecting the context var, and the route's own getApp() stub is used.
  tryGetApp: () => null,
  resetApp: async () => {},
}));

const fetchCallRecord = vi.fn();
const mintSession = vi.fn();
vi.mock("~/server/scenarios/voice/voice-transport.registry", () => ({
  voiceTransportRegistry: {
    elevenlabs_convai: {
      missingKeyMessage: "No ElevenLabs key in this project",
      createAgentAdapter: () => ({}),
      mintSession: (...a: unknown[]) => mintSession(...a),
      fetchCallRecord: (...a: unknown[]) => fetchCallRecord(...a),
      endCall: vi.fn(async () => {}),
    },
  },
}));

import { signVoiceSessionToken } from "~/server/scenarios/voice/voice-session-token";
import { app } from "../app";

const PROJECT_ID = "project_owned";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MINT_BODY = {
  projectId: PROJECT_ID,
  transport: "elevenlabs_convai",
  agentId: "el_agent",
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerAuthSession.mockResolvedValue({ user: { id: "user_1" } });
  probeProjectPermission.mockResolvedValue(true);
  getScenarioRunData.mockResolvedValue(null);
  findElevenLabsProviderForProject.mockResolvedValue({ id: "prov_1" });
  getElevenLabsApiCredential.mockResolvedValue({
    apiKey: "sk-secret",
    baseUrl: "https://api.elevenlabs.io",
  });
});

describe("Feature: Voice session HTTP door", () => {
  describe("given no logged-in user", () => {
    /** @scenario "An unauthenticated Talk to it request is refused" */
    it("refuses the mint as unauthenticated", async () => {
      getServerAuthSession.mockResolvedValue(null);
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(401);
      expect(mintSession).not.toHaveBeenCalled();
    });
  });

  describe("given a user without permission on the project", () => {
    /** @scenario "A Talk to it request for another project is refused" */
    it("refuses the mint as forbidden", async () => {
      probeProjectPermission.mockResolvedValue(false);
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(403);
      expect(mintSession).not.toHaveBeenCalled();
    });
  });

  describe("given the project has no ElevenLabs key", () => {
    /** @scenario "A session mint without a provider key is refused with the key-missing code" */
    it("refuses the mint with the key-missing code", async () => {
      findElevenLabsProviderForProject.mockResolvedValue(null);
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("voice_key_missing");
      expect(mintSession).not.toHaveBeenCalled();
    });
  });

  describe("given a finish with a bad session token", () => {
    /** @scenario "A finish with an invalid or expired session token is refused" */
    it("refuses with the session-invalid code and writes nothing", async () => {
      const res = await post("/api/voice/session/conv_1/finish", {
        projectId: PROJECT_ID,
        sessionToken: "not.a.valid.token",
        transcript: [],
        startedAt: 1,
        endedAt: 2,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("voice_session_invalid");
      expect(fetchCallRecord).not.toHaveBeenCalled();
    });
  });

  describe("given a finish for a different project than the token was minted for", () => {
    /** @scenario "A session minted for one project cannot finish a call in another project" */
    it("refuses with the session-invalid code and writes nothing", async () => {
      const token = signVoiceSessionToken({
        sessionId: "sess_1",
        projectId: PROJECT_ID,
        agentId: "agent_row",
        agentExternalId: "el_agent_mine",
        transport: "elevenlabs_convai",
        exp: Date.now() + 60_000,
      });

      const res = await post("/api/voice/session/conv_1/finish", {
        projectId: "project_other",
        sessionToken: token,
        conversationId: "conv_1",
        transcript: [],
        startedAt: 1,
        endedAt: 2,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("voice_session_invalid");
      expect(fetchCallRecord).not.toHaveBeenCalled();
    });
  });

  describe("given a finish whose conversation ran against another agent", () => {
    /** @scenario "A finish whose conversation ran against another agent is refused" */
    it("refuses with the conversation-mismatch code and writes nothing", async () => {
      const token = signVoiceSessionToken({
        sessionId: "sess_1",
        projectId: PROJECT_ID,
        agentId: "agent_row",
        agentExternalId: "el_agent_mine",
        transport: "elevenlabs_convai",
        exp: Date.now() + 60_000,
      });
      fetchCallRecord.mockResolvedValue({
        conversationId: "conv_1",
        transport: "elevenlabs_convai",
        agentExternalId: "el_agent_someone_else",
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        turns: [],
        cutAtLimit: false,
        source: "provider",
      });

      const res = await post("/api/voice/session/conv_1/finish", {
        projectId: PROJECT_ID,
        sessionToken: token,
        conversationId: "conv_1",
        transcript: [],
        startedAt: 1,
        endedAt: 2,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("voice_conversation_mismatch");
    });
  });

  describe("given a recording request for a conversation with no run", () => {
    /** @scenario "The recording proxy refuses a conversation with no run in the project" */
    it("answers Recording unavailable and never fetches the provider", async () => {
      getScenarioRunData.mockResolvedValue(null);
      const res = await app.request(
        `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("Recording unavailable");
    });
  });
});
