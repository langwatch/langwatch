import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.mjs";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../unsubscribeToken";

describe("unsubscribeToken", () => {
  describe("given NEXTAUTH_SECRET is empty", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe("when signing or verifying", () => {
      it("throws rather than minting forgeable tokens", () => {
        vi.spyOn(env, "NEXTAUTH_SECRET", "get").mockReturnValue("");
        expect(() =>
          signUnsubscribeToken({
            projectId: "p",
            triggerId: "t",
            email: "a@b.com",
          }),
        ).toThrow(/NEXTAUTH_SECRET/);
      });
    });
  });

  describe("given a freshly signed token", () => {
    describe("when it is verified unchanged", () => {
      it("round-trips the payload", () => {
        const token = signUnsubscribeToken({
          projectId: "proj_1",
          triggerId: "trig_1",
          email: "Recipient@Example.com",
        });
        const payload = verifyUnsubscribeToken(token);
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
          projectId: "proj_1",
          triggerId: null,
          email: "a@b.com",
        });
        const payload = verifyUnsubscribeToken(token);
        expect(payload?.triggerId).toBeNull();
      });
    });
  });

  describe("given a token whose payload has been tampered with", () => {
    describe("when it is verified", () => {
      it("rejects the forged token", () => {
        const token = signUnsubscribeToken({
          projectId: "proj_1",
          triggerId: "trig_1",
          email: "victim@example.com",
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
        expect(verifyUnsubscribeToken(forged)).toBeNull();
      });
    });
  });

  describe("given a malformed token", () => {
    describe("when it has no signature segment", () => {
      it("returns null", () => {
        expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
      });
    });
  });

  describe("given the same recipient in different letter cases", () => {
    describe("when both are signed", () => {
      it("produces identical tokens", () => {
        const lower = signUnsubscribeToken({
          projectId: "p",
          triggerId: "t",
          email: "user@example.com",
        });
        const upper = signUnsubscribeToken({
          projectId: "p",
          triggerId: "t",
          email: "USER@EXAMPLE.COM",
        });
        expect(lower).toEqual(upper);
      });
    });
  });
});
