/**
 * The signed session token round-trips its claims, and every tamper — bad
 * signature, edited payload, wrong shape, elapsed expiry — verifies to
 * null. A secret is passed explicitly, so no environment is read.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type { VoiceSessionTokenPayload } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { signVoiceSessionToken, verifyVoiceSessionToken } from "../voice-session-token.ts";

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
  const INVALID = expect.objectContaining({ code: "voice_session_invalid" });

  describe("given a signed token", () => {
    describe("when a token is signed and verified with the same secret", () => {
      it("round-trips the claims", () => {
        const token = signVoiceSessionToken({
          payload: PAYLOAD,
          secret: SECRET,
        });
        expect(verifyVoiceSessionToken({ token, now: NOW, secret: SECRET })).toEqual(PAYLOAD);
      });
    });

    describe("when the signature does not match the secret", () => {
      it("refuses as an invalid session", () => {
        const token = signVoiceSessionToken({
          payload: PAYLOAD,
          secret: SECRET,
        });
        expect(() => verifyVoiceSessionToken({ token, now: NOW, secret: "other-secret" })).toThrow(
          INVALID,
        );
      });
    });

    describe("when the payload is edited after signing", () => {
      it("refuses as an invalid session", () => {
        const token = signVoiceSessionToken({
          payload: PAYLOAD,
          secret: SECRET,
        });
        const [, signature] = token.split(".");
        const forged = Buffer.from(
          JSON.stringify({ ...PAYLOAD, projectId: "p2" }),
          "utf8",
        ).toString("base64url");
        expect(() =>
          verifyVoiceSessionToken({
            token: `${forged}.${signature}`,
            now: NOW,
            secret: SECRET,
          }),
        ).toThrow(INVALID);
      });
    });

    describe("when the token has expired", () => {
      it("refuses as an invalid session", () => {
        const token = signVoiceSessionToken({
          payload: PAYLOAD,
          secret: SECRET,
        });
        expect(() => verifyVoiceSessionToken({ token, now: PAYLOAD.exp, secret: SECRET })).toThrow(
          INVALID,
        );
      });
    });

    describe("when the token is malformed", () => {
      it("refuses as an invalid session", () => {
        expect(() =>
          verifyVoiceSessionToken({
            token: "garbage",
            now: NOW,
            secret: SECRET,
          }),
        ).toThrow(INVALID);
        expect(() => verifyVoiceSessionToken({ token: "a.b.c", now: NOW, secret: SECRET })).toThrow(
          INVALID,
        );
      });
    });
  });
});
