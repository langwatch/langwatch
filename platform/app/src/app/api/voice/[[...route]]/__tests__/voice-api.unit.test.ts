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

const isEnabled = vi.fn();
vi.mock("~/server/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/featureFlag")>();
  return {
    ...actual,
    featureFlagService: {
      isEnabled: (...args: unknown[]) => isEnabled(...args),
    },
  };
});

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: vi.fn(async () => "org_1"),
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

const findById = vi.fn();
vi.mock("~/server/agents/agent.repository", () => ({
  AgentRepository: class {
    findById(...args: unknown[]) {
      return findById(...args);
    }
  },
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
  agentId: "agent_from_body",
  agentRowId: "agent_row",
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerAuthSession.mockResolvedValue({ user: { id: "user_1" } });
  probeProjectPermission.mockResolvedValue(true);
  isEnabled.mockResolvedValue(true);
  getScenarioRunData.mockResolvedValue(null);
  findElevenLabsProviderForProject.mockResolvedValue({ id: "prov_1" });
  getElevenLabsApiCredential.mockResolvedValue({
    apiKey: "sk-secret",
    baseUrl: "https://api.elevenlabs.io",
  });
  // The stored voice agent row a mint resolves its vendor agent id from.
  findById.mockResolvedValue({
    id: "agent_row",
    projectId: PROJECT_ID,
    type: "voice",
    config: { transport: "elevenlabs_convai", agentId: "el_agent" },
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

  describe("given a mint request for an agent row that does not exist", () => {
    it("refuses with the agent-not-found code, as a 404", async () => {
      findById.mockResolvedValue(null);
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("agent_not_found");
      expect(mintSession).not.toHaveBeenCalled();
    });
  });

  describe("given a mint request for a row that is not a voice agent", () => {
    it("refuses with the agent-not-found code, as a 404", async () => {
      findById.mockResolvedValue({
        id: "agent_row",
        projectId: PROJECT_ID,
        type: "http",
        config: {},
      });
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("agent_not_found");
      expect(mintSession).not.toHaveBeenCalled();
    });
  });

  describe("given a mint request for a valid voice agent row", () => {
    it("mints against the row's stored vendor agent id, not a body value", async () => {
      findById.mockResolvedValue({
        id: "agent_row",
        projectId: PROJECT_ID,
        type: "voice",
        config: { transport: "elevenlabs_convai", agentId: "el_agent_stored" },
      });
      mintSession.mockResolvedValue({ signedUrl: "wss://signed.example/abc" });

      const res = await post("/api/voice/session", MINT_BODY);

      expect(res.status).toBe(200);
      expect(mintSession).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "el_agent_stored" }),
      );
      const body = (await res.json()) as { sessionToken: string };
      const claims = JSON.parse(
        Buffer.from(
          body.sessionToken.split(".")[0] ?? "",
          "base64url",
        ).toString("utf8"),
      ) as { agentExternalId: string; agentId: string };
      expect(claims.agentExternalId).toBe("el_agent_stored");
      expect(claims.agentId).toBe("agent_row");
    });
  });

  describe("given a mint request with no agent row yet (an unsaved draft)", () => {
    it("mints against the body's agent id and a null row id", async () => {
      mintSession.mockResolvedValue({ signedUrl: "wss://signed.example/abc" });

      const res = await post("/api/voice/session", {
        projectId: PROJECT_ID,
        transport: "elevenlabs_convai",
        agentId: "agent_from_body",
      });

      expect(res.status).toBe(200);
      expect(findById).not.toHaveBeenCalled();
      expect(mintSession).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "agent_from_body" }),
      );
      const body = (await res.json()) as { sessionToken: string };
      const claims = JSON.parse(
        Buffer.from(
          body.sessionToken.split(".")[0] ?? "",
          "base64url",
        ).toString("utf8"),
      ) as { agentExternalId: string; agentId: string | null };
      expect(claims.agentExternalId).toBe("agent_from_body");
      expect(claims.agentId).toBeNull();
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

  describe("given a recording request for a conversation with a run", () => {
    /** @scenario "The finished call plays its recording through the same-origin proxy url" */
    it("proxies the audio with a no-store Cache-Control so it is never CDN-cached", async () => {
      getScenarioRunData.mockResolvedValue({ id: "run_1" });
      const upstreamFetch = vi.fn(async () => ({
        ok: true,
        body: new ReadableStream(),
        headers: new Headers({ "content-type": "audio/mpeg" }),
      }));
      vi.stubGlobal("fetch", upstreamFetch);

      // finally so a failing assertion cannot leak the stub onto later tests (isolate: false)
      try {
        const res = await app.request(
          `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
        );

        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("fetches with redirect: error so the api key cannot be forwarded", async () => {
      getScenarioRunData.mockResolvedValue({ id: "run_1" });
      const upstreamFetch = vi.fn(async () => ({
        ok: true,
        body: new ReadableStream(),
        headers: new Headers({ "content-type": "audio/mpeg" }),
      }));
      vi.stubGlobal("fetch", upstreamFetch);

      // finally so a failing assertion cannot leak the stub onto later tests (isolate: false)
      try {
        await app.request(
          `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
        );

        expect(upstreamFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ redirect: "error" }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    describe("when the provider fetch rejects", () => {
      it("answers Recording unavailable on a refused redirect", async () => {
        getScenarioRunData.mockResolvedValue({ id: "run_1" });
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new TypeError("fetch failed: unexpected redirect");
          }),
        );

        try {
          const res = await app.request(
            `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
          );

          expect(res.status).toBe(404);
          expect((await res.json()).error).toBe("Recording unavailable");
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it("answers Recording unavailable on a connect timeout", async () => {
        getScenarioRunData.mockResolvedValue({ id: "run_1" });
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new DOMException("The operation was aborted", "AbortError");
          }),
        );

        try {
          const res = await app.request(
            `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
          );

          expect(res.status).toBe(404);
          expect((await res.json()).error).toBe("Recording unavailable");
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });
  });

  describe("given the project's release_voice_agents_enabled flag is off", () => {
    beforeEach(() => {
      isEnabled.mockResolvedValue(false);
    });

    /** @scenario "A mint request is refused with a 404 while the voice flag is off" */
    it("refuses the mint with the disabled code, as a 404", async () => {
      const res = await post("/api/voice/session", MINT_BODY);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("voice_agents_disabled");
      expect(mintSession).not.toHaveBeenCalled();
    });

    /** @scenario "A finish request is refused with a 404 while the voice flag is off" */
    it("refuses the finish with the disabled code, as a 404", async () => {
      const token = signVoiceSessionToken({
        sessionId: "sess_1",
        projectId: PROJECT_ID,
        agentId: "agent_row",
        agentExternalId: "el_agent_mine",
        transport: "elevenlabs_convai",
        exp: Date.now() + 60_000,
      });
      const res = await post("/api/voice/session/conv_1/finish", {
        projectId: PROJECT_ID,
        sessionToken: token,
        conversationId: "conv_1",
        transcript: [],
        startedAt: 1,
        endedAt: 2,
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("voice_agents_disabled");
      expect(fetchCallRecord).not.toHaveBeenCalled();
    });

    /** @scenario "The audio proxy is refused with a 404 while the voice flag is off" */
    it("refuses the audio proxy with the disabled code, as a 404", async () => {
      const res = await app.request(
        `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
      );
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("voice_agents_disabled");
      expect(getScenarioRunData).not.toHaveBeenCalled();
    });
  });
});
