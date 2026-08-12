import { describe, expect, it } from "vitest";
import {
  bitsetFromBase64Url,
  bitsetHasPermission,
  bitsetToBase64Url,
  encodePermissionBitset,
} from "../bitset";
import { mintPassport, verifyPassport } from "../passport";

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
  const secret = "test-passport-secret";

  function mint(epoch = 7) {
    return mintPassport({
      principal: { type: "user", id: "alice" },
      organizationId: "org-1",
      scopedPermissions: [
        { scopeKey: "project:proj-1", permissions: ["traces:view"] },
      ],
      epoch,
      secret,
      ttlSeconds: 60,
      now,
    });
  }

  describe("given a freshly minted passport", () => {
    it("verifies with the matching epoch and carries the bitmap", () => {
      const token = mint();
      const verification = verifyPassport({
        token: token!,
        currentEpoch: 7,
        secret,
        now,
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

      expect(
        verifyPassport({ token: tampered, currentEpoch: 7, secret, now }),
      ).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  describe("when the passport has expired", () => {
    it("fails with expired", () => {
      const token = mint()!;
      expect(
        verifyPassport({
          token,
          currentEpoch: 7,
          secret,
          now: () => now() + 61_000,
        }),
      ).toEqual({ ok: false, reason: "expired" });
    });
  });

  describe("when a grant write bumped the epoch after minting", () => {
    it("fails with stale-epoch — revocation outruns the TTL", () => {
      const token = mint(7)!;
      expect(verifyPassport({ token, currentEpoch: 8, secret, now })).toEqual({
        ok: false,
        reason: "stale-epoch",
      });
    });
  });

  describe("when the epoch store is unavailable", () => {
    it("fails closed", () => {
      const token = mint()!;
      expect(
        verifyPassport({ token, currentEpoch: null, secret, now }),
      ).toEqual({
        ok: false,
        reason: "stale-epoch",
      });
    });
  });

  describe("when no secret is provided", () => {
    it("mints nothing and verifies nothing", () => {
      expect(
        mintPassport({
          principal: { type: "user", id: "alice" },
          organizationId: "org-1",
          scopedPermissions: [],
          epoch: 1,
          secret: undefined,
          now,
        }),
      ).toBeNull();
      expect(
        verifyPassport({
          token: "a.b",
          currentEpoch: 1,
          secret: undefined,
          now,
        }),
      ).toEqual({
        ok: false,
        reason: "no-secret",
      });
    });
  });
});
