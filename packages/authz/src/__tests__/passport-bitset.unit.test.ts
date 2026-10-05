import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bitsetHasPermission, encodePermissionBitset } from "../bitset";
import {
  bitsetFromBase64Url,
  bitsetToBase64Url,
  MAX_PASSPORT_TTL_SECONDS,
  type PassportPayload,
  PassportService,
} from "../passport";

describe("permission bitsets", () => {
  it("round-trips a permission set through encode/decode", () => {
    const bitset = encodePermissionBitset([
      "traces:view",
      "datasets:manage",
      "virtualKeys:rotate",
    ]);
    const decoded = bitsetFromBase64Url(bitsetToBase64Url(bitset));

    expect(
      bitsetHasPermission({ bitset: decoded, permission: "traces:view" }),
    ).toBe(true);
    expect(
      bitsetHasPermission({ bitset: decoded, permission: "datasets:manage" }),
    ).toBe(true);
    expect(
      bitsetHasPermission({ bitset: decoded, permission: "traces:update" }),
    ).toBe(false);
  });

  it("ignores strings outside the registry", () => {
    const bitset = encodePermissionBitset(["traces:rotate", "nonsense"]);
    expect(bitsetHasPermission({ bitset, permission: "traces:rotate" })).toBe(
      false,
    );
  });
});

describe("authz passports", () => {
  const now = () => 1_700_000_000_000;
  const nowSeconds = Math.floor(now() / 1000);
  const secret = "test-passport-secret";
  const passports = new PassportService({ secret, now });

  function mint(epoch = 7, ttlSeconds = 60) {
    return passports.mint({
      principal: { type: "user", id: "alice" },
      organizationId: "org-1",
      scopedPermissions: [
        { scopeKey: "project:proj-1", permissions: ["traces:view"] },
      ],
      epoch,
      ttlSeconds,
    });
  }

  /** Signs an arbitrary body with the same secret, producing a correctly
   *  signed but structurally invalid payload — validation after integrity,
   *  which is what the payload guards are for. */
  function signedToken(body: string): string {
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  }

  function tokenCarrying(payload: unknown): string {
    return signedToken(
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
    );
  }

  const validPayload: PassportPayload = {
    v: 1,
    p: "user:alice",
    o: "org-1",
    s: {},
    e: 7,
    iat: nowSeconds,
    x: nowSeconds + MAX_PASSPORT_TTL_SECONDS,
  };

  describe("given a freshly minted passport", () => {
    it("verifies with the matching epoch and carries the bitmap", () => {
      const token = mint();
      const verification = passports.verify({
        token: token!,
        currentEpoch: 7,
      });
      expect(verification.ok).toBe(true);
      if (!verification.ok) return;
      const bitset = bitsetFromBase64Url(
        verification.payload.s["project:proj-1"]!,
      );
      expect(bitsetHasPermission({ bitset, permission: "traces:view" })).toBe(
        true,
      );
      expect(verification.payload.p).toBe("user:alice");
    });
  });

  describe("when the token is tampered with", () => {
    it("fails with bad-signature", () => {
      const token = mint()!;
      const [body, signature] = token.split(".") as [string, string];
      const tampered = `${Buffer.from(
        JSON.stringify({
          ...(JSON.parse(
            Buffer.from(body, "base64url").toString("utf8"),
          ) as object),
          p: "user:mallory",
        }),
      ).toString("base64url")}.${signature}`;

      expect(passports.verify({ token: tampered, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    });
  });

  describe("when the passport has expired", () => {
    it("fails with expired", () => {
      const token = mint()!;
      const later = new PassportService({
        secret,
        now: () => now() + 61_000,
      });
      expect(later.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  describe("when the token is not a passport at all", () => {
    it("fails with malformed on a token with no signature part", () => {
      expect(
        passports.verify({ token: "just-one-part", currentEpoch: 7 }),
      ).toEqual({ ok: false, reason: "malformed" });
    });

    it("fails with malformed on a correctly signed non-JSON body", () => {
      const token = signedToken(
        Buffer.from("not json at all").toString("base64url"),
      );
      expect(passports.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "malformed",
      });
    });

    it("fails with malformed on a payload from a future format version", () => {
      const token = tokenCarrying({ ...validPayload, v: 2 });
      expect(passports.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "malformed",
      });
    });

    it("fails with malformed when the issuance time is not an integer", () => {
      const token = tokenCarrying({ ...validPayload, iat: "yesterday" });
      expect(passports.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "malformed",
      });
    });

    it("fails with malformed when the expiry is not an integer", () => {
      const token = tokenCarrying({ ...validPayload, x: null });
      expect(passports.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  describe("when a longer life is asked for than the ceiling allows", () => {
    it("clamps the minted expiry to the 60s ceiling", () => {
      const verification = passports.verify({
        token: mint(7, 3600)!,
        currentEpoch: 7,
      });
      expect(verification.ok).toBe(true);
      if (!verification.ok) return;
      expect(verification.payload.x).toBe(
        nowSeconds + MAX_PASSPORT_TTL_SECONDS,
      );
    });

    it("expires that passport 61 seconds later like any other", () => {
      const later = new PassportService({ secret, now: () => now() + 61_000 });
      expect(later.verify({ token: mint(7, 3600)!, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "expired",
      });
    });

    it("refuses an expiry stretched further past the issuance time", () => {
      const token = tokenCarrying({
        ...validPayload,
        x: validPayload.iat + MAX_PASSPORT_TTL_SECONDS + 1,
      });
      expect(passports.verify({ token, currentEpoch: 7 })).toEqual({
        ok: false,
        reason: "ttl-exceeded",
      });
    });
  });

  describe("when the verifier's clock runs behind the issuer's", () => {
    it("still accepts a max-TTL passport — the ceiling anchors on iat", () => {
      const behind = new PassportService({ secret, now: () => now() - 1_000 });
      const verification = behind.verify({
        token: mint(7, MAX_PASSPORT_TTL_SECONDS)!,
        currentEpoch: 7,
      });
      expect(verification.ok).toBe(true);
    });
  });

  describe("when a grant write bumped the epoch after minting", () => {
    it("fails with stale-epoch — revocation outruns the TTL", () => {
      const token = mint(7)!;
      expect(passports.verify({ token, currentEpoch: 8 })).toEqual({
        ok: false,
        reason: "stale-epoch",
      });
    });
  });

  describe("when the epoch store is unavailable", () => {
    it("fails closed", () => {
      const token = mint()!;
      expect(passports.verify({ token, currentEpoch: null })).toEqual({
        ok: false,
        reason: "stale-epoch",
      });
    });
  });

  describe("when no secret is provided", () => {
    it("mints nothing and verifies nothing", () => {
      const secretless = new PassportService({ secret: undefined, now });
      expect(
        secretless.mint({
          principal: { type: "user", id: "alice" },
          organizationId: "org-1",
          scopedPermissions: [],
          epoch: 1,
        }),
      ).toBeNull();
      expect(secretless.verify({ token: "a.b", currentEpoch: 1 })).toEqual({
        ok: false,
        reason: "no-secret",
      });
    });
  });
});
