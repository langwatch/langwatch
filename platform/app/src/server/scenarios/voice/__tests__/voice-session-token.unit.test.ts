/**
 * The signed session token round-trips its claims, and every tamper — a bad
 * signature, an edited payload, a wrong shape, an elapsed expiry — verifies to
 * null. A secret is passed explicitly so no environment is read.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";
import {
  signVoiceSessionToken,
  type VoiceSessionTokenPayload,
  verifyVoiceSessionToken,
} from "../voice-session-token";

const SECRET = "test-secret-value";
const NOW = 1_000_000;

const PAYLOAD: VoiceSessionTokenPayload = {
  sessionId: "sess_1",
  projectId: "p1",
  agentId: "agent_row",
  agentExternalId: "el_agent",
  transport: "elevenlabs_convai",
  exp: NOW + 60_000,
};

describe("voice session token", () => {
  describe("when a token is signed and verified with the same secret", () => {
    it("round-trips the claims", () => {
      const token = signVoiceSessionToken(PAYLOAD, SECRET);
      expect(verifyVoiceSessionToken(token, NOW, SECRET)).toEqual(PAYLOAD);
    });
  });

  describe("when the signature does not match the secret", () => {
    it("verifies to null", () => {
      const token = signVoiceSessionToken(PAYLOAD, SECRET);
      expect(verifyVoiceSessionToken(token, NOW, "other-secret")).toBeNull();
    });
  });

  describe("when the payload is edited after signing", () => {
    it("verifies to null", () => {
      const token = signVoiceSessionToken(PAYLOAD, SECRET);
      const [, signature] = token.split(".");
      const forged = Buffer.from(
        JSON.stringify({ ...PAYLOAD, projectId: "p2" }),
        "utf8",
      ).toString("base64url");
      expect(
        verifyVoiceSessionToken(`${forged}.${signature}`, NOW, SECRET),
      ).toBeNull();
    });
  });

  describe("when the token has expired", () => {
    it("verifies to null", () => {
      const token = signVoiceSessionToken(PAYLOAD, SECRET);
      expect(verifyVoiceSessionToken(token, PAYLOAD.exp, SECRET)).toBeNull();
    });
  });

  describe("when the token is malformed", () => {
    it("verifies to null", () => {
      expect(verifyVoiceSessionToken("garbage", NOW, SECRET)).toBeNull();
      expect(verifyVoiceSessionToken("a.b.c", NOW, SECRET)).toBeNull();
    });
  });
});
