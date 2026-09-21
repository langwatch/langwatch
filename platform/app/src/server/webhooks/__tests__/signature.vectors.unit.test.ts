import fs from "fs";
import { describe, expect, it } from "vitest";

import {
  buildVectors,
  serializeVectors,
  VECTORS_RELATIVE_PATH,
  type VectorOutcome,
  type VerificationVector,
  vectorsFilePath,
} from "~/tasks/generateWebhookSignatureVectors";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "../signature";

/**
 * The committed vectors are the contract between this sender and the two SDK
 * verifiers, so they are only worth anything while they still describe THIS
 * file. Two assertions keep that true: the committed bytes must be what the
 * generator would write today, and the sender's own reference verifier must
 * reach the verdict each case claims.
 *
 * A change to the signing algorithm therefore fails here first, before it can
 * reach an SDK suite that would happily agree with a locally edited fixture.
 */
describe("webhook signature vectors", () => {
  const committed = fs.readFileSync(vectorsFilePath(), "utf8");

  it("the committed file is exactly what the generator writes", () => {
    // Regenerate with: pnpm run task generateWebhookSignatureVectors
    expect(committed).toBe(serializeVectors());
  });

  it("lives where both SDK suites look for it", () => {
    expect(vectorsFilePath().endsWith(VECTORS_RELATIVE_PATH)).toBe(true);
    expect(fs.existsSync(vectorsFilePath())).toBe(true);
  });

  const vectors = buildVectors();

  it("pins the tolerance the SDKs default to", () => {
    expect(vectors.default_tolerance_seconds).toBe(
      WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
    );
  });

  it("covers every outcome a receiver has to tell apart", () => {
    const outcomes = new Set(vectors.verification.map((c) => c.expected));
    expect([...outcomes].sort()).toEqual([
      "invalid_signature",
      "malformed_header",
      "stale_timestamp",
      "valid",
    ] satisfies VectorOutcome[]);
  });

  /**
   * The sender answers a boolean, so it can only confirm the valid/not-valid
   * split. Which KIND of failure a case is stays the SDKs' concern, and is
   * asserted there against this same file.
   */
  describe.each(vectors.verification)("$name", (vector: VerificationVector) => {
    it(`the sender's reference verifier agrees it is ${vector.expected}`, () => {
      const accepted = vector.secrets.some((secret) =>
        verifyWebhookSignature({
          secret,
          body: vector.body,
          header: vector.header,
          nowSeconds: vector.now_seconds,
          ...(vector.tolerance_seconds !== undefined
            ? { toleranceSeconds: vector.tolerance_seconds }
            : {}),
        }),
      );
      expect(accepted).toBe(vector.expected === "valid");
    });
  });

  describe.each(vectors.signing)("$name", (vector) => {
    it("carries one v1 per non-empty secret, newest first", () => {
      const emitted = (vector.expected_header.match(/v1=/g) ?? []).length;
      expect(emitted).toBe(vector.secrets.filter((s) => s.length > 0).length);
      expect(vector.expected_header.startsWith(`t=${vector.timestamp},`)).toBe(
        true,
      );
    });
  });
});
