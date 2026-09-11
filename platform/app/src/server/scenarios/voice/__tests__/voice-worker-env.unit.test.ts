/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";
import { readVoiceWorkerEnv, VOICE_WS_PORT_DEFAULT } from "../voice-worker-env";

describe("readVoiceWorkerEnv", () => {
  describe("given no variables set", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("defaults the websocket port and leaves the public base URL unset", () => {
      const env = readVoiceWorkerEnv({});

      expect(env.voiceWsPort).toBe(VOICE_WS_PORT_DEFAULT);
      expect(env.voiceWsPort).toBe(3300);
      expect(env.voicePublicBaseUrl).toBeUndefined();
      expect(env.voiceTunnelEnabled).toBe(true);
    });
  });

  describe("given a websocket port", () => {
    /** @scenario "The voice worker reads its infrastructure environment variables" */
    it("parses a valid port and defaults a blank one", () => {
      expect(readVoiceWorkerEnv({ VOICE_WS_PORT: "4400" }).voiceWsPort).toBe(
        4400,
      );
      expect(readVoiceWorkerEnv({ VOICE_WS_PORT: "" }).voiceWsPort).toBe(
        VOICE_WS_PORT_DEFAULT,
      );
    });
  });

  describe("given a public base URL", () => {
    /** @scenario "A public base URL must be an https origin" */
    it("accepts and reports a valid https origin", () => {
      const env = readVoiceWorkerEnv({
        VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
      });

      expect(env.voicePublicBaseUrl).toBe("https://voice.example.com");
    });

    /** @scenario "A public base URL must be an https origin" */
    it("rejects a non-https public base URL", () => {
      expect(() =>
        readVoiceWorkerEnv({
          VOICE_PUBLIC_BASE_URL: "http://voice.example.com",
        }),
      ).toThrowError(/https/);
    });

    /** @scenario "An explicit public base URL always wins over the tunnel fallback" */
    it("prefers an explicit public base URL over the tunnel fallback, even with VOICE_TUNNEL on", () => {
      const env = readVoiceWorkerEnv({
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
