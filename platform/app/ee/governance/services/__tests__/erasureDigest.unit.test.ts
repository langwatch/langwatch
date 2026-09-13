// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ERASURE_SECRET_ENV,
  ErasureSecretMissingError,
  erasureDigest,
  readErasureSecret,
} from "../logic/erasureDigest";

const SECRET = "a".repeat(32);

describe("given the digest that stands in for an erased identifier", () => {
  describe("when the construction itself is pinned", () => {
    it("is HMAC, not the secret prefixed to the identifier", () => {
      const digest = erasureDigest({
        secret: SECRET,
        identifier: "m@acme.test",
      });

      // Pinned rather than recomputed, because a stored suppression list is only
      // as portable as this construction: change it and every digest already
      // written stops matching, with no way back — the identifiers needed to
      // recompute them are exactly what the erasure destroyed.
      expect(digest).toBe(
        "83b2fef62d746c83cdde05c05cef34cdf0552ce0a826ced06d5f3231ce0d911b",
      );
      expect(digest).toBe(
        createHmac("sha256", SECRET).update("m@acme.test").digest("hex"),
      );
      // The construction this replaced, spelled out so a revert cannot pass.
      expect(digest).not.toBe(
        createHash("sha256").update(SECRET).update("m@acme.test").digest("hex"),
      );
    });
  });

  describe("when the same identifier is hashed twice", () => {
    it("produces the same value both times", () => {
      const first = erasureDigest({
        secret: SECRET,
        identifier: "m@acme.test",
      });
      const second = erasureDigest({
        secret: SECRET,
        identifier: "m@acme.test",
      });

      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("when two different identifiers are hashed", () => {
    it("keeps them apart", () => {
      expect(
        erasureDigest({ secret: SECRET, identifier: "a@acme.test" }),
      ).not.toBe(erasureDigest({ secret: SECRET, identifier: "b@acme.test" }));
    });
  });

  describe("when the same identifier is hashed under two secrets", () => {
    it("produces different values, which is why the secret must never rotate", () => {
      expect(
        erasureDigest({ secret: SECRET, identifier: "m@acme.test" }),
      ).not.toBe(
        erasureDigest({ secret: "b".repeat(32), identifier: "m@acme.test" }),
      );
    });
  });

  describe("when identifiers differ only in case", () => {
    it("treats them as different, matching how the money rows key them", () => {
      expect(
        erasureDigest({ secret: SECRET, identifier: "M@Acme.test" }),
      ).not.toBe(erasureDigest({ secret: SECRET, identifier: "m@acme.test" }));
    });
  });
});

describe("given a deployment's erasure secret", () => {
  describe("when it is set to a long enough value", () => {
    it("reads it back", () => {
      expect(readErasureSecret({ [ERASURE_SECRET_ENV]: SECRET })).toBe(SECRET);
    });
  });

  describe("when it is unset", () => {
    /** @scenario "Erasure refuses to run without its secret" */
    it("refuses and names the setting", () => {
      expect(() => readErasureSecret({})).toThrow(ErasureSecretMissingError);
      expect(() => readErasureSecret({})).toThrow(ERASURE_SECRET_ENV);
    });
  });

  describe("when it is too short to be a secret", () => {
    it("refuses rather than hashing with it", () => {
      expect(() =>
        readErasureSecret({ [ERASURE_SECRET_ENV]: "short" }),
      ).toThrow(ErasureSecretMissingError);
    });
  });
});
