import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribeToken";

/**
 * The signing key is a parameter, not an environment read, so every case here
 * exercises the real code path — including the empty-key refusal, which used
 * to need an `env` mutation that never reached the module.
 */
const SECRET = "unsubscribe-signing-secret";

describe("unsubscribeToken", () => {
  describe("given no signing secret", () => {
    describe("when signing with an empty secret", () => {
      it("throws rather than minting forgeable tokens", () => {
        expect(() =>
          signUnsubscribeToken({
            payload: { projectId: "p", triggerId: "t", email: "a@b.com" },
            secret: "",
          }),
        ).toThrow(/NEXTAUTH_SECRET/);
      });
    });

    describe("when signing with no secret at all", () => {
      it("throws rather than minting forgeable tokens", () => {
        expect(() =>
          signUnsubscribeToken({
            payload: { projectId: "p", triggerId: "t", email: "a@b.com" },
            secret: undefined,
          }),
        ).toThrow(/NEXTAUTH_SECRET/);
      });
    });

    describe("when verifying a well-formed token with an empty secret", () => {
      it("throws rather than accepting an unkeyed signature", () => {
        const token = signUnsubscribeToken({
          payload: { projectId: "p", triggerId: "t", email: "a@b.com" },
          secret: SECRET,
        });
        expect(() => verifyUnsubscribeToken({ token, secret: "" })).toThrow(/NEXTAUTH_SECRET/);
      });
    });
  });

  describe("given a freshly signed token", () => {
    describe("when it is verified unchanged", () => {
      it("round-trips the payload", () => {
        const token = signUnsubscribeToken({
          payload: {
            projectId: "proj_1",
            triggerId: "trig_1",
            email: "Recipient@Example.com",
          },
          secret: SECRET,
        });
        const payload = verifyUnsubscribeToken({ token, secret: SECRET });
        expect(payload).toEqual({
          projectId: "proj_1",
          triggerId: "trig_1",
          email: "recipient@example.com",
        });
      });
    });

    describe("when the trigger scope is project-wide (null triggerId)", () => {
      it("round-trips a null triggerId", () => {
        const token = signUnsubscribeToken({
          payload: { projectId: "proj_1", triggerId: null, email: "a@b.com" },
          secret: SECRET,
        });
        const payload = verifyUnsubscribeToken({ token, secret: SECRET });
        expect(payload?.triggerId).toBeNull();
      });
    });

    describe("when it is verified under a different secret", () => {
      it("rejects the token, so rotating the secret invalidates every link", () => {
        const token = signUnsubscribeToken({
          payload: { projectId: "proj_1", triggerId: "trig_1", email: "a@b.com" },
          secret: SECRET,
        });
        expect(verifyUnsubscribeToken({ token, secret: "rotated-secret" })).toBeNull();
      });
    });
  });

  describe("given a token whose payload has been tampered with", () => {
    describe("when it is verified", () => {
      it("rejects the forged token", () => {
        const token = signUnsubscribeToken({
          payload: {
            projectId: "proj_1",
            triggerId: "trig_1",
            email: "victim@example.com",
          },
          secret: SECRET,
        });
        const [, sig] = token.split(".");
        const forgedPayload = Buffer.from(
          JSON.stringify({
            projectId: "proj_1",
            triggerId: "trig_1",
            email: "attacker@example.com",
          }),
        ).toString("base64url");
        const forged = `${forgedPayload}.${sig}`;
        expect(verifyUnsubscribeToken({ token: forged, secret: SECRET })).toBeNull();
      });
    });
  });

  describe("given a malformed token", () => {
    describe("when it has no signature segment", () => {
      it("returns null", () => {
        expect(verifyUnsubscribeToken({ token: "not-a-token", secret: SECRET })).toBeNull();
      });
    });
  });

  describe("given the same recipient in different letter cases", () => {
    describe("when both are signed", () => {
      it("produces identical tokens", () => {
        const lower = signUnsubscribeToken({
          payload: { projectId: "p", triggerId: "t", email: "user@example.com" },
          secret: SECRET,
        });
        const upper = signUnsubscribeToken({
          payload: { projectId: "p", triggerId: "t", email: "USER@EXAMPLE.COM" },
          secret: SECRET,
        });
        expect(lower).toEqual(upper);
      });
    });
  });
});
