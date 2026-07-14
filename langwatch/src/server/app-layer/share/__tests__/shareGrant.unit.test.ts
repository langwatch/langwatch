import jwt from "jsonwebtoken";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildShareGrantCookie,
  readShareGrantFromCookieHeader,
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

    it("round-trips the conversation capability on a trace grant", () => {
      const threadedClaims: ShareGrantClaims = {
        ...claims,
        thread_id: "conversation_1",
      };

      const { jwt: token } = signShareGrant(threadedClaims);

      expect(verifyShareGrant(token)).toEqual(threadedClaims);
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

    it("refuses to mint a grant for an expired share", () => {
      expect(() => signShareGrant(claims, new Date())).toThrow(
        "Cannot sign a share grant for an expired share",
      );
    });

    it("refuses to mint a grant for an immediately expiring share", () => {
      expect(() => signShareGrant(claims, new Date(Date.now() + 500))).toThrow(
        "Cannot sign a share grant for an expired share",
      );
    });
  });

  describe("when the share expires before the normal grant TTL", () => {
    it("caps the grant expiry at the share expiry", () => {
      const shareExpiresAt = new Date(Date.now() + 30_000);

      const grant = signShareGrant(claims, shareExpiresAt);

      expect(grant.expiresAt).toBeLessThanOrEqual(
        Math.floor(shareExpiresAt.getTime() / 1000),
      );
      expect(grant.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
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

  /**
   * The HTTP transport is the tRPC fetch adapter behind Hono, whose request
   * shim exposes only raw headers — there is no parsed `.cookies` map. Reading
   * the grant therefore has to parse the `Cookie` header itself.
   */
  describe("reading the grant back from a Cookie header", () => {
    it("round-trips a grant issued via buildShareGrantCookie", () => {
      const { jwt: token } = signShareGrant(claims);
      // A Set-Cookie value's first pair is the cookie; a request Cookie header
      // carries just the name=value pairs.
      const cookieHeader = `${SHARE_GRANT_COOKIE}=${token}`;

      expect(readShareGrantFromCookieHeader(cookieHeader)).toEqual(claims);
    });

    it("finds the grant among other cookies", () => {
      const { jwt: token } = signShareGrant(claims);
      const header = `foo=bar; ${SHARE_GRANT_COOKIE}=${token}; baz=qux`;

      expect(readShareGrantFromCookieHeader(header)).toEqual(claims);
    });

    it("returns null when the cookie is absent, empty or malformed", () => {
      expect(readShareGrantFromCookieHeader(null)).toBeNull();
      expect(readShareGrantFromCookieHeader("")).toBeNull();
      expect(readShareGrantFromCookieHeader("foo=bar")).toBeNull();
      expect(readShareGrantFromCookieHeader("novalue")).toBeNull();
    });

    it("returns null when the cookie carries a forged grant", () => {
      const header = `${SHARE_GRANT_COOKIE}=not-a-real-jwt`;

      expect(readShareGrantFromCookieHeader(header)).toBeNull();
    });
  });
});
