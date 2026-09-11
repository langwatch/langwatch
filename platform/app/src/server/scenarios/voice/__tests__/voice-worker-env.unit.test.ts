/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import { readVoiceWorkerEnv, VOICE_WS_PORT_DEFAULT } from "../voice-worker-env";

describe("readVoiceWorkerEnv", () => {
  describe("given no variables set", () => {
    /** @scenario "The voice worker reads its three infrastructure environment variables" */
    it("leaves voice worker only off and defaults the websocket port", () => {
      const env = readVoiceWorkerEnv({});

      expect(env.voiceWorkerOnly).toBe(false);
      expect(env.voiceWsPort).toBe(VOICE_WS_PORT_DEFAULT);
      expect(env.voiceWsPort).toBe(3300);
      expect(env.voicePublicBaseUrl).toBeUndefined();
      expect(env.voiceTunnelEnabled).toBe(true);
    });
  });

  describe("given VOICE_WORKER_ONLY values", () => {
    /** @scenario "The voice worker reads its three infrastructure environment variables" */
    it("stays off for anything that is not the literal true", () => {
      expect(
        readVoiceWorkerEnv({ VOICE_WORKER_ONLY: "false" }).voiceWorkerOnly,
      ).toBe(false);
      expect(
        readVoiceWorkerEnv({ VOICE_WORKER_ONLY: "1" }).voiceWorkerOnly,
      ).toBe(false);
      expect(
        readVoiceWorkerEnv({ VOICE_WORKER_ONLY: "yes" }).voiceWorkerOnly,
      ).toBe(false);
    });

    /** @scenario "The voice worker reads its three infrastructure environment variables" */
    it("turns on for the literal true, case-insensitively, given a public base URL", () => {
      expect(
        readVoiceWorkerEnv({
          VOICE_WORKER_ONLY: "TRUE",
          VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
        }).voiceWorkerOnly,
      ).toBe(true);
    });
  });

  describe("given a websocket port", () => {
    /** @scenario "The voice worker reads its three infrastructure environment variables" */
    it("parses a valid port and defaults a blank one", () => {
      expect(readVoiceWorkerEnv({ VOICE_WS_PORT: "4400" }).voiceWsPort).toBe(
        4400,
      );
      expect(readVoiceWorkerEnv({ VOICE_WS_PORT: "" }).voiceWsPort).toBe(
        VOICE_WS_PORT_DEFAULT,
      );
    });
  });

  describe("given voice worker only is on and no public base URL", () => {
    /** @scenario "A voice worker refuses to start without a public base URL" */
    it("refuses to start when the tunnel fallback is also disabled", () => {
      expect(() =>
        readVoiceWorkerEnv({
          VOICE_WORKER_ONLY: "true",
          VOICE_TUNNEL: "false",
        }),
      ).toThrowError(/VOICE_PUBLIC_BASE_URL/);
    });

    /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
    it("does not throw when the tunnel fallback is left on (the default)", () => {
      const env = readVoiceWorkerEnv({ VOICE_WORKER_ONLY: "true" });

      expect(env.voiceWorkerOnly).toBe(true);
      expect(env.voicePublicBaseUrl).toBeUndefined();
      expect(env.voiceTunnelEnabled).toBe(true);
    });
  });

  describe("given voice worker only is on", () => {
    /** @scenario "A voice worker refuses to start without a public base URL" */
    it("starts with a public https base URL and reports it", () => {
      const env = readVoiceWorkerEnv({
        VOICE_WORKER_ONLY: "true",
        VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
      });

      expect(env.voiceWorkerOnly).toBe(true);
      expect(env.voicePublicBaseUrl).toBe("https://voice.example.com");
    });

    /** @scenario "A voice worker refuses to start without a public base URL" */
    it("rejects a non-https public base URL", () => {
      expect(() =>
        readVoiceWorkerEnv({
          VOICE_WORKER_ONLY: "true",
          VOICE_PUBLIC_BASE_URL: "http://voice.example.com",
        }),
      ).toThrowError(/https/);
    });

    /** @scenario "An explicit public base URL always wins over the tunnel fallback" */
    it("prefers an explicit public base URL over the tunnel fallback, even with VOICE_TUNNEL on", () => {
      const env = readVoiceWorkerEnv({
        VOICE_WORKER_ONLY: "true",
        VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
        VOICE_TUNNEL: "true",
      });

      expect(env.voicePublicBaseUrl).toBe("https://voice.example.com");
      expect(env.voiceTunnelEnabled).toBe(true);
    });
  });

  describe("given VOICE_TUNNEL values", () => {
    /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
    it("is enabled for anything that is not the literal false", () => {
      expect(
        readVoiceWorkerEnv({ VOICE_TUNNEL: "TRUE" }).voiceTunnelEnabled,
      ).toBe(true);
      expect(readVoiceWorkerEnv({ VOICE_TUNNEL: "" }).voiceTunnelEnabled).toBe(
        true,
      );
      expect(
        readVoiceWorkerEnv({ VOICE_TUNNEL: "nonsense" }).voiceTunnelEnabled,
      ).toBe(true);
    });

    /** @scenario "A voice worker opens a quick tunnel when no public base URL is configured" */
    it("is disabled for the literal false, case-insensitively", () => {
      expect(
        readVoiceWorkerEnv({ VOICE_TUNNEL: "FALSE" }).voiceTunnelEnabled,
      ).toBe(false);
      expect(
        readVoiceWorkerEnv({ VOICE_TUNNEL: "false" }).voiceTunnelEnabled,
      ).toBe(false);
    });
  });
});
