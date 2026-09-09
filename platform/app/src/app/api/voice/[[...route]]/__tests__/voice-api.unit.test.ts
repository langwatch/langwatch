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
    // No-op run writes so a saved-agent finish can complete without a real
    // event-sourcing pipeline (the authz tests only care about who is let in).
    startRun: vi.fn(async () => {}),
    messageSnapshot: vi.fn(async () => {}),
    finishRun: vi.fn(async () => {}),
  },
  // No-op span recording: a finish records one trace per exchange before the
  // run write; the authz tests only care about who is let in.
  traces: { recordSpan: vi.fn(async () => {}) },
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
    describe("when the mint request is sent", () => {
      /** @scenario "An unauthenticated Talk to it request is refused" */
      it("refuses the mint as unauthenticated", async () => {
        getServerAuthSession.mockResolvedValue(null);
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(401);
        expect(mintSession).not.toHaveBeenCalled();
      });
    });

    describe("when a finish request carries a garbage token", () => {
      // Auth runs before token verification, so a logged-out caller is refused
      // 401 and cannot probe token validity (which would answer 400) through
      // the finish route.
      it("refuses as unauthenticated, not as an invalid token", async () => {
        getServerAuthSession.mockResolvedValue(null);
        const res = await post("/api/voice/session/conv_1/finish", {
          projectId: PROJECT_ID,
          sessionToken: "not.a.valid.token",
          transcript: [],
          startedAt: 1,
          endedAt: 2,
        });
        expect(res.status).toBe(401);
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a user without permission on the project", () => {
    describe("when the mint request is sent", () => {
      /** @scenario "A Talk to it request for another project is refused" */
      it("refuses the mint as forbidden", async () => {
        probeProjectPermission.mockResolvedValue(false);
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(403);
        expect(mintSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project has no ElevenLabs key", () => {
    describe("when the mint request is sent", () => {
      /** @scenario "A session mint without a provider key is refused with the key-missing code" */
      it("refuses the mint with the key-missing code", async () => {
        findElevenLabsProviderForProject.mockResolvedValue(null);
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("voice_key_missing");
        expect(mintSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a mint request for an agent row that does not exist", () => {
    describe("when the mint is attempted", () => {
      it("refuses with the agent-not-found code, as a 404", async () => {
        findById.mockResolvedValue(null);
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("agent_not_found");
        expect(mintSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a mint request for a row that is not a voice agent", () => {
    describe("when the mint is attempted", () => {
      it("refuses with the agent-not-found code, as a 404", async () => {
        findById.mockResolvedValue({
          id: "agent_row",
          projectId: PROJECT_ID,
          type: "http",
          config: {},
        });
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("agent_not_found");
        expect(mintSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a mint request for a valid voice agent row", () => {
    describe("when the mint is attempted", () => {
      it("mints against the row's stored vendor agent id, not a body value", async () => {
        findById.mockResolvedValue({
          id: "agent_row",
          projectId: PROJECT_ID,
          type: "voice",
          config: {
            transport: "elevenlabs_convai",
            agentId: "el_agent_stored",
          },
        });
        mintSession.mockResolvedValue({
          signedUrl: "wss://signed.example/abc",
        });

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
  });

  describe("given a mint request with no agent row yet (an unsaved draft)", () => {
    describe("when the mint is attempted", () => {
      it("mints against the body's agent id and a null row id", async () => {
        mintSession.mockResolvedValue({
          signedUrl: "wss://signed.example/abc",
        });

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
  });

  describe("given a member with scenarios:create but not evaluations:manage", () => {
    // Any create-an-agent path (mint with no row, finish with no agent id)
    // needs evaluations:manage; the scenarios:create-only member is denied it.
    beforeEach(() => {
      probeProjectPermission.mockImplementation(
        (_witness: unknown, _projectId: string, permission: string) =>
          Promise.resolve(permission !== "evaluations:manage"),
      );
    });

    describe("when they mint without a saved agent row", () => {
      /** @scenario "Talk to it without agent-management rights and no saved row is refused" */
      it("refuses with project_permission_denied for evaluations:manage and mints nothing", async () => {
        const res = await post("/api/voice/session", {
          projectId: PROJECT_ID,
          transport: "elevenlabs_convai",
          agentId: "agent_from_body",
        });

        expect(res.status).toBe(403);
        // The error handler spreads a HandledError's meta bag flat into the
        // body, so the field is `permission`, not `meta.permission`.
        const body = (await res.json()) as {
          error: string;
          permission?: string;
        };
        expect(body.error).toBe("project_permission_denied");
        expect(body.permission).toBe("evaluations:manage");
        expect(mintSession).not.toHaveBeenCalled();
      });
    });

    describe("when they finish a session that carries no saved agent id", () => {
      /** @scenario "Finishing an unsaved session without agent-management rights is refused" */
      it("refuses with a 403 and never creates an agent", async () => {
        const token = signVoiceSessionToken({
          payload: {
            sessionId: "sess_1",
            projectId: PROJECT_ID,
            agentId: null,
            agentExternalId: "el_agent_mine",
            transport: "elevenlabs_convai",
            exp: Date.now() + 60_000,
          },
        });

        const res = await post("/api/voice/session/conv_1/finish", {
          projectId: PROJECT_ID,
          sessionToken: token,
          name: "New agent",
          conversationId: "conv_1",
          transcript: [],
          startedAt: 1,
          endedAt: 2,
        });

        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("project_permission_denied");
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });

    describe("when they mint against a saved agent row", () => {
      /** @scenario "Talk to it against a saved agent needs only scenario rights" */
      it("mints, because the saved-row path creates no agent", async () => {
        mintSession.mockResolvedValue({
          signedUrl: "wss://signed.example/abc",
        });

        const res = await post("/api/voice/session", MINT_BODY);

        expect(res.status).toBe(200);
        expect(mintSession).toHaveBeenCalled();
      });
    });

    describe("when they finish a session that carries a saved agent id", () => {
      /** @scenario "Talk to it against a saved agent needs only scenario rights" */
      it("is not refused for permission, because no agent is created", async () => {
        const token = signVoiceSessionToken({
          payload: {
            sessionId: "sess_1",
            projectId: PROJECT_ID,
            agentId: "agent_row",
            agentExternalId: "el_agent_mine",
            transport: "elevenlabs_convai",
            exp: Date.now() + 60_000,
          },
        });
        // Provider not ready: the finish writes the (empty) browser transcript
        // and succeeds without creating an agent.
        fetchCallRecord.mockResolvedValue(null);

        const res = await post("/api/voice/session/conv_1/finish", {
          projectId: PROJECT_ID,
          sessionToken: token,
          conversationId: "conv_1",
          transcript: [],
          startedAt: 1,
          endedAt: 2,
        });

        expect(res.status).toBe(200);
      });
    });
  });

  describe("given a member with both scenarios:create and evaluations:manage", () => {
    describe("when they mint without a saved agent row", () => {
      /** @scenario "Talk to it with agent-management rights mints an unsaved session" */
      it("mints the session that will create the agent on finish", async () => {
        probeProjectPermission.mockResolvedValue(true);
        mintSession.mockResolvedValue({
          signedUrl: "wss://signed.example/abc",
        });

        const res = await post("/api/voice/session", {
          projectId: PROJECT_ID,
          transport: "elevenlabs_convai",
          agentId: "agent_from_body",
        });

        expect(res.status).toBe(200);
        expect(mintSession).toHaveBeenCalled();
      });
    });
  });

  describe("given a finish with a bad session token", () => {
    describe("when the finish request is sent", () => {
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
        expect((await res.json()).error).toBe("voice_session_invalid");
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a finish for a different project than the token was minted for", () => {
    describe("when the finish request is sent", () => {
      /** @scenario "A session minted for one project cannot finish a call in another project" */
      it("refuses with the session-invalid code and writes nothing", async () => {
        const token = signVoiceSessionToken({
          payload: {
            sessionId: "sess_1",
            projectId: PROJECT_ID,
            agentId: "agent_row",
            agentExternalId: "el_agent_mine",
            transport: "elevenlabs_convai",
            exp: Date.now() + 60_000,
          },
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
        expect((await res.json()).error).toBe("voice_session_invalid");
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a finish whose conversation ran against another agent", () => {
    describe("when the finish request is sent", () => {
      /** @scenario "A finish whose conversation ran against another agent is refused" */
      it("refuses with the conversation-mismatch code and writes nothing", async () => {
        const token = signVoiceSessionToken({
          payload: {
            sessionId: "sess_1",
            projectId: PROJECT_ID,
            agentId: "agent_row",
            agentExternalId: "el_agent_mine",
            transport: "elevenlabs_convai",
            exp: Date.now() + 60_000,
          },
        });
        fetchCallRecord.mockResolvedValue({
          conversationId: "conv_1",
          transport: "elevenlabs_convai",
          agentExternalId: "el_agent_someone_else",
          startedAt: 1,
          endedAt: 2,
          durationMs: 1,
          turns: [],
          isCutAtLimit: false,
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
        expect((await res.json()).error).toBe("voice_conversation_mismatch");
      });
    });
  });

  describe("given a recording request for a conversation with no run", () => {
    describe("when the audio proxy is requested", () => {
      /** @scenario "The recording proxy refuses a conversation with no run in the project" */
      it("answers recording_unavailable and never fetches the provider", async () => {
        getScenarioRunData.mockResolvedValue(null);
        const res = await app.request(
          `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
        );
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("voice_recording_unavailable");
      });
    });
  });

  describe("given a recording request for a run whose project has no ElevenLabs credential", () => {
    describe("when the audio proxy is requested", () => {
      it("answers recording_key_missing and never fetches the provider", async () => {
        getScenarioRunData.mockResolvedValue({ id: "run_1" });
        findElevenLabsProviderForProject.mockResolvedValue(null);
        const upstreamFetch = vi.fn();
        vi.stubGlobal("fetch", upstreamFetch);

        // finally so a failing assertion cannot leak the stub onto later tests (isolate: false)
        try {
          const res = await app.request(
            `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
          );
          expect(res.status).toBe(404);
          expect((await res.json()).error).toBe("voice_recording_key_missing");
          expect(upstreamFetch).not.toHaveBeenCalled();
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });
  });

  describe("given a recording request for a conversation with a run", () => {
    describe("when the audio proxy is requested", () => {
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
    });

    describe("when the provider fetch rejects", () => {
      it("answers voice_recording_unavailable on a refused redirect", async () => {
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
          expect((await res.json()).error).toBe("voice_recording_unavailable");
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it("answers voice_recording_unavailable on a connect timeout", async () => {
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
          expect((await res.json()).error).toBe("voice_recording_unavailable");
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

    describe("when the mint request is sent", () => {
      /** @scenario "A mint request is refused with a 404 while the voice flag is off" */
      it("refuses the mint with the disabled code, as a 404", async () => {
        const res = await post("/api/voice/session", MINT_BODY);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("voice_agents_disabled");
        expect(mintSession).not.toHaveBeenCalled();
      });
    });

    describe("when the finish request is sent", () => {
      /** @scenario "A finish request is refused with a 404 while the voice flag is off" */
      it("refuses the finish with the disabled code, as a 404", async () => {
        const token = signVoiceSessionToken({
          payload: {
            sessionId: "sess_1",
            projectId: PROJECT_ID,
            agentId: "agent_row",
            agentExternalId: "el_agent_mine",
            transport: "elevenlabs_convai",
            exp: Date.now() + 60_000,
          },
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
        expect((await res.json()).error).toBe("voice_agents_disabled");
        expect(fetchCallRecord).not.toHaveBeenCalled();
      });
    });

    describe("when the audio proxy is requested", () => {
      /** @scenario "The audio proxy is refused with a 404 while the voice flag is off" */
      it("refuses the audio proxy with the disabled code, as a 404", async () => {
        const res = await app.request(
          `/api/voice/session/conv_1/audio?projectId=${PROJECT_ID}`,
        );
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("voice_agents_disabled");
        expect(getScenarioRunData).not.toHaveBeenCalled();
      });
    });
  });
});
