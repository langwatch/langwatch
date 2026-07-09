import jwt from "jsonwebtoken";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildShareGrantCookie,
  SHARE_GRANT_COOKIE,
  type ShareGrantClaims,
  signShareGrant,
  verifyShareGrant,
} from "../shareGrant";

const claims: ShareGrantClaims = {
  share_id: "share_1",
  project_id: "project_1",
  resource_type: "TRACE",
  resource_id: "trace_a",
  thread_id: null,
};

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-chars-long-xx";
});

describe("share grant", () => {
  describe("given a grant signed by this deployment", () => {
    it("round-trips the claims", () => {
      const { jwt: token } = signShareGrant(claims);

      expect(verifyShareGrant(token)).toEqual(claims);
    });
  });

  describe("given a tampered grant", () => {
    it("rejects a grant whose payload was edited", () => {
      const { jwt: token } = signShareGrant(claims);
      const [header, _payload, signature] = token.split(".");
      const forged = Buffer.from(
        JSON.stringify({ ...claims, resource_id: "trace_b" }),
      ).toString("base64url");

      expect(verifyShareGrant(`${header}.${forged}.${signature}`)).toBeNull();
    });

    it("rejects a grant signed with a different secret", () => {
      const foreign = jwt.sign(claims, "some-other-secret-32-chars-longggg", {
        algorithm: "HS256",
        issuer: "langwatch-control-plane",
        audience: "langwatch-share",
        expiresIn: 600,
      });

      expect(verifyShareGrant(foreign)).toBeNull();
    });

    /** A gateway JWT must not be usable as a share grant (audience is scoped). */
    it("rejects a token minted for another audience", () => {
      const otherAudience = jwt.sign(claims, process.env.NEXTAUTH_SECRET!, {
        algorithm: "HS256",
        issuer: "langwatch-control-plane",
        audience: "langwatch-gateway",
        expiresIn: 600,
      });

      expect(verifyShareGrant(otherAudience)).toBeNull();
    });
  });

  describe("given an expired grant", () => {
    it("rejects it", () => {
      const expired = jwt.sign(claims, process.env.NEXTAUTH_SECRET!, {
        algorithm: "HS256",
        issuer: "langwatch-control-plane",
        audience: "langwatch-share",
        expiresIn: -1,
      });

      expect(verifyShareGrant(expired)).toBeNull();
    });
  });

  describe("given garbage input", () => {
    it("returns null instead of throwing", () => {
      expect(verifyShareGrant("not-a-jwt")).toBeNull();
      expect(verifyShareGrant("")).toBeNull();
    });
  });

  describe("the grant cookie", () => {
    it("is httpOnly, path-scoped and SameSite=Lax", () => {
      const cookie = buildShareGrantCookie("abc.def.ghi");

      expect(cookie).toContain(`${SHARE_GRANT_COOKIE}=abc.def.ghi`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("SameSite=Lax");
    });
  });
});
