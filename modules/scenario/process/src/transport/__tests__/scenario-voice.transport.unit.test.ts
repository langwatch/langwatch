/**
 * Main's voice-session doors: mint and finish over tRPC, the recording over REST.
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import {
  VoiceRecordingKeyMissingError,
  VoiceRecordingUnavailableError,
} from "@langwatch/scenario-contract/voice-runtime";
import type { ContentfulStatusCode } from "hono/utils/http-status";
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
    /** @scenario "An unauthenticated Talk to it request is refused" */
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

const boundaryErrorHandler: RestErrorHandler = (error, context) =>
  HandledError.isHandled(error)
    ? context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode)
    : context.json({ error: "internal_server_error" }, 500);

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
    onError: boundaryErrorHandler,
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
      expect(await response.json()).toEqual({ code: "voice_recording_unavailable" });
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
    onError: boundaryErrorHandler,
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
      expect(await response.json()).toEqual({ code: "voice_recording_key_missing" });
    });
  });
});
