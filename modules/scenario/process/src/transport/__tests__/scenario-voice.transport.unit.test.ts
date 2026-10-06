/**
 * Main's voice-session doors: mint and finish over tRPC and REST, the recording over REST.
 * @vitest-environment node
 */
import { SurfaceUnverifiedError } from "@langwatch/api";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import {
  VoiceRecordingKeyMissingError,
  VoiceRecordingUnavailableError,
  VoiceSessionInvalidError,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { scenarioVoiceRest } from "../scenario-voice.rest.ts";
import { scenarioTrpcTransport } from "../scenario.trpc.ts";
import {
  scenarioTrpcCaller,
  stubScenarioApi,
  VIEWER_PERMISSIONS,
} from "./scenario-trpc.fixture.ts";

const mintResult = {
  transport: "elevenlabs_convai" as const,
  sessionToken: "token",
  maxDurationSeconds: 300,
  connect: { signedUrl: "wss://example.test/signed" },
};
const finishResult = {
  runId: "scenariorun_1",
  agentId: "agent_1",
  source: "provider" as const,
  hasFetchFailed: false,
  hasAudio: true,
  audioUrl: "/api/voice/session/conv_1/audio?projectId=project_1",
};

describe("the voice-session procedures", () => {
  describe("given a caller whose role holds only scenarios:view", () => {
    it("reaches the app, which authorizes the call itself", async () => {
      const mintVoiceSession = vi.fn<ScenarioApi["mintVoiceSession"]>(async () => mintResult);
      const { caller } = scenarioTrpcCaller({
        declaration: scenarioTrpcTransport,
        app: stubScenarioApi({ mintVoiceSession }),
        permissions: VIEWER_PERMISSIONS,
      });

      const minted = await caller.mintVoiceSession({
        projectId: "project_1",
        transport: "elevenlabs_convai",
        agentId: "  vendor_agent  ",
      });

      expect(minted).toEqual(mintResult);
      expect(mintVoiceSession).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1", agentId: "vendor_agent" }),
      );
      expect(mintVoiceSession.mock.calls[0]?.[0].userId).toEqual(expect.any(String));
    });
  });

  describe("given a request with no logged-in user", () => {
    /** @scenario "A Talk to it tRPC request with no logged-in user is refused" */
    it("refuses it as unauthenticated and mints no session", async () => {
      const mintVoiceSession = vi.fn<ScenarioApi["mintVoiceSession"]>(async () => mintResult);
      const { caller } = scenarioTrpcCaller({
        declaration: scenarioTrpcTransport,
        app: stubScenarioApi({ mintVoiceSession }),
        actor: null,
      });

      const refusal = await caller
        .mintVoiceSession({
          projectId: "project_1",
          transport: "elevenlabs_convai",
          agentId: "vendor_agent",
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(refusal).toMatchObject({ code: "UNAUTHORIZED" });
      expect(mintVoiceSession).not.toHaveBeenCalled();
    });
  });

  describe("given a finished call", () => {
    it("hands the token, transcript and defaults to the app and answers main's shape", async () => {
      const finishVoiceSession = vi.fn<ScenarioApi["finishVoiceSession"]>(async () => finishResult);
      const { caller } = scenarioTrpcCaller({
        declaration: scenarioTrpcTransport,
        app: stubScenarioApi({ finishVoiceSession }),
      });

      const finished = await caller.finishVoiceSession({
        projectId: "project_1",
        sessionToken: "token",
        startedAt: 1,
        endedAt: 2,
      });

      expect(finished).toEqual(finishResult);
      expect(finishVoiceSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionToken: "token", transcript: [], isCutAtLimit: false }),
      );
    });
  });
});

function audioDoor(stream: ScenarioApi["streamVoiceSessionAudio"]) {
  const streamVoiceSessionAudio = vi.fn(stream);
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: { type: "user", id: "user_1" }, scope: null }),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const hono = runtime.mount(scenarioVoiceRest.router(), {
    app: () => createApiFixture<ScenarioApi>({ streamVoiceSessionAudio }),
    onError: canonicalErrorResponse,
  });
  const request = () =>
    hono.request("http://api.test/api/voice/session/conv_1/audio?projectId=project_1");

  return { request, streamVoiceSessionAudio };
}

describe("GET /api/voice/session/:conversationId/audio", () => {
  describe("given a recording the provider serves", () => {
    it("relays the bytes as audio/mpeg without caching", async () => {
      const { request, streamVoiceSessionAudio } = audioDoor(async () => ({
        mediaType: "audio/mpeg",
        stream: new Blob([new Uint8Array([1, 2, 3])]).stream(),
      }));

      const response = await request();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("audio/mpeg");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
      expect(streamVoiceSessionAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          conversationId: "conv_1",
          userId: "user_1",
        }),
      );
    });
  });

  describe("given no recording to play", () => {
    it("refuses with voice_recording_unavailable", async () => {
      const { request } = audioDoor(async () => {
        throw new VoiceRecordingUnavailableError();
      });

      const response = await request();

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "voice_recording_unavailable" });
    });
  });
});

function runAudioDoor(stream: ScenarioApi["streamVoiceRunAudio"]) {
  const streamVoiceRunAudio = vi.fn(stream);
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: { type: "user", id: "user_1" }, scope: null }),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const hono = runtime.mount(scenarioVoiceRest.router(), {
    app: () => createApiFixture<ScenarioApi>({ streamVoiceRunAudio }),
    onError: canonicalErrorResponse,
  });
  const request = () =>
    hono.request("http://api.test/api/voice/run/scenariorun_1/audio?projectId=project_1");

  return { request, streamVoiceRunAudio };
}

describe("GET /api/voice/run/:scenarioRunId/audio", () => {
  describe("given a phone run whose Twilio recording is published", () => {
    /** @scenario "A phone run's published Twilio recording is relayed" */
    it("relays the bytes as audio/wav without caching", async () => {
      const { request, streamVoiceRunAudio } = runAudioDoor(async () => ({
        mediaType: "audio/wav",
        stream: new Blob([new Uint8Array([4, 5])]).stream(),
      }));

      const response = await request();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("audio/wav");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5]);
      expect(streamVoiceRunAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          scenarioRunId: "scenariorun_1",
          userId: "user_1",
        }),
      );
    });
  });

  describe("given a run whose provider key is missing", () => {
    /** @scenario "A run whose provider key is missing is refused by name" */
    it("refuses with voice_recording_key_missing", async () => {
      const { request } = runAudioDoor(async () => {
        throw new VoiceRecordingKeyMissingError();
      });

      const response = await request();

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "voice_recording_key_missing" });
    });
  });
});

function sessionDoor({
  app,
  signedIn = true,
}: {
  app: Partial<Pick<ScenarioApi, "mintVoiceSession" | "finishVoiceSession">>;
  signedIn?: boolean;
}) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => {
        if (!signedIn) throw new SurfaceUnverifiedError("browser");

        return { actor: { type: "user", id: "user_1" }, scope: null };
      },
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const hono = runtime.mount(scenarioVoiceRest.router(), {
    app: () => createApiFixture<ScenarioApi>(app),
    onError: canonicalErrorResponse,
  });

  return (path: string, body: object) =>
    hono.request(`http://api.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

describe("POST /api/voice/session", () => {
  describe("given a signed-in caller and the form's values", () => {
    /** @scenario "The Talk to it panel mints a voice session over REST" */
    it("mints through the app as that user and answers main's body", async () => {
      const mintVoiceSession = vi.fn<ScenarioApi["mintVoiceSession"]>(async () => mintResult);
      const post = sessionDoor({ app: { mintVoiceSession } });

      const response = await post("/api/voice/session", {
        projectId: "project_1",
        transport: "elevenlabs_convai",
        agentId: "  vendor_agent  ",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(mintResult);
      expect(mintVoiceSession).toHaveBeenCalledWith({
        projectId: "project_1",
        transport: "elevenlabs_convai",
        agentId: "vendor_agent",
        userId: "user_1",
      });
    });
  });

  describe("given a request with no logged-in user", () => {
    /** @scenario "A Talk to it REST request with no logged-in user is refused" */
    it("refuses it as unauthenticated and mints no session", async () => {
      const mintVoiceSession = vi.fn<ScenarioApi["mintVoiceSession"]>(async () => mintResult);
      const post = sessionDoor({ app: { mintVoiceSession }, signedIn: false });

      const response = await post("/api/voice/session", {
        projectId: "project_1",
        transport: "elevenlabs_convai",
        agentId: "vendor_agent",
      });

      expect(response.status).toBe(401);
      expect(mintVoiceSession).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/voice/session/:sessionId/finish", () => {
  describe("given a finished call and its signed token", () => {
    /** @scenario "The Talk to it panel reports a finished call over REST" */
    it("hands the token, transcript and defaults to the app and answers main's body", async () => {
      const finishVoiceSession = vi.fn<ScenarioApi["finishVoiceSession"]>(async () => finishResult);
      const post = sessionDoor({ app: { finishVoiceSession } });

      const response = await post("/api/voice/session/session_1/finish", {
        projectId: "project_1",
        sessionToken: "token",
        startedAt: 1,
        endedAt: 2,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(finishResult);
      expect(finishVoiceSession).toHaveBeenCalledWith({
        projectId: "project_1",
        sessionToken: "token",
        startedAt: 1,
        endedAt: 2,
        transcript: [],
        isCutAtLimit: false,
        userId: "user_1",
      });
    });
  });

  describe("given a token the app does not accept", () => {
    /** @scenario "A finish with a token that does not verify is refused by name" */
    it("answers the app's handled refusal", async () => {
      const post = sessionDoor({
        app: {
          finishVoiceSession: async () => {
            throw new VoiceSessionInvalidError();
          },
        },
      });

      const response = await post("/api/voice/session/session_1/finish", {
        projectId: "project_1",
        sessionToken: "forged",
        startedAt: 1,
        endedAt: 2,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "voice_session_invalid" });
    });
  });
});
