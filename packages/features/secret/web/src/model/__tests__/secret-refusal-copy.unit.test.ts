/**
 * Every refusal this feature can raise has words a customer can act on.
 *
 * The guard is exhaustiveness against the CONTRACT rather than against a list
 * kept here: each `HandledError` subclass in `@langwatch/secret-contract`
 * carries its own `code`, and a new one added without copy fails this. That is
 * the local stand-in for the presentation registry's type-level exhaustiveness,
 * which cannot help while none of these codes is listed in
 * `platform/app/src/features/errors/logic/codes.ts` — which is exactly how they
 * came to have no copy at all.
 *
 * Spec: specs/secrets/secrets-manager.feature
 */

import {
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
} from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import {
  describeSecretRefusal,
  readSecretRefusalCode,
  SECRET_REFUSAL_CODES,
} from "../secret-refusal-copy";

/** One instance of every refusal the feature declares. */
const REFUSALS = [
  new SecretNotFoundError(),
  new SecretReservedNameError("langy_vk_secret"),
  new SecretLimitReachedError(),
  new SecretDuplicateError("OPENAI_API_KEY"),
];

describe("given every refusal the secret feature declares", () => {
  describe("when the copy table is asked about each one", () => {
    /** @scenario A refused secret write says why */
    it("answers with a title and a sentence for all of them", () => {
      for (const refusal of REFUSALS) {
        const copy = describeSecretRefusal({ data: { error: { code: refusal.code } } });
        expect(copy, `no copy for ${refusal.code}`).toBeDefined();
        expect(copy!.title.length).toBeGreaterThan(0);
        expect(copy!.description.length).toBeGreaterThan(0);
      }
    });

    /** @scenario A refused secret write says why */
    it("carries no code the feature cannot raise, so nothing here is dead copy", () => {
      expect([...SECRET_REFUSAL_CODES].sort()).toEqual(
        REFUSALS.map((refusal) => refusal.code).sort(),
      );
    });

    /** @scenario A refused secret write says why */
    it("never puts the wire message in front of a customer", () => {
      // Since #5984 the wire message of a handled error is the code slug, so
      // copy that echoed it would print `secret_already_exists` at somebody.
      for (const refusal of REFUSALS) {
        const copy = describeSecretRefusal({ data: { error: { code: refusal.code } } })!;
        expect(copy.title).not.toContain(refusal.code);
        expect(copy.description).not.toContain(refusal.code);
      }
    });
  });
});

describe("given a failure from a boundary that spells the code differently", () => {
  describe("when the code is read", () => {
    /** @scenario A refused secret write says why */
    it("finds it nested under a tRPC payload and flat on a REST one", () => {
      expect(readSecretRefusalCode({ data: { error: { code: "secret_not_found" } } })).toBe(
        "secret_not_found",
      );
      expect(readSecretRefusalCode({ error: "secret_not_found" })).toBe("secret_not_found");
    });

    /** @scenario A refused secret write says why */
    it("answers nothing for an unhandled failure rather than guessing", () => {
      expect(readSecretRefusalCode(new Error("boom"))).toBeUndefined();
      expect(readSecretRefusalCode(null)).toBeUndefined();
      expect(describeSecretRefusal(new Error("boom"))).toBeUndefined();
    });
  });
});
