import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "../signature";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * The strongest twin pin available, and the reason this file reads a committed
 * artefact rather than a sibling module: `specs/webhooks/signature-vectors.json`
 * is generated from the APPLICATION's signer and is already what the TypeScript
 * SDK and the Python SDK verify against. A packaged signer that reproduces every
 * header in it byte for byte cannot have drifted from the sender a customer's
 * receiver was built against — and if the application's signer ever changes, the
 * regenerated file fails here as well as in both SDKs.
 */

const VECTORS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../specs/webhooks/signature-vectors.json",
);

interface SigningVector {
  name: string;
  body: string;
  timestamp: number;
  secrets: string[];
  expected_header: string;
}

interface VerificationVector {
  name: string;
  body: string;
  header: string;
  secrets: string[];
  now_seconds: number;
  tolerance_seconds?: number;
  expected: "valid" | "malformed_header" | "stale_timestamp" | "invalid_signature";
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as {
  headers: { signature: string; delivery_id: string; event_id: string };
  default_tolerance_seconds: number;
  signing: SigningVector[];
  verification: VerificationVector[];
};

describe("the published signature vectors", () => {
  describe("given the vectors generated from the application's signer", () => {
    /** @scenario "The signature reproduces the published vectors byte for byte" */
    it("reproduces every signing vector byte for byte", () => {
      expect(vectors.signing.length).toBeGreaterThan(0);
      for (const vector of vectors.signing) {
        expect(
          signWebhookPayload({
            secrets: vector.secrets,
            body: vector.body,
            timestampSeconds: vector.timestamp,
          }),
          vector.name,
        ).toBe(vector.expected_header);
      }
    });

    /** @scenario "The packaged verifier answers every published verification vector" */
    it("accepts exactly the verification vectors published as valid", () => {
      expect(vectors.verification.length).toBeGreaterThan(0);
      for (const vector of vectors.verification) {
        const accepted = vector.secrets.some((secret) =>
          verifyWebhookSignature({
            secret,
            body: vector.body,
            header: vector.header,
            nowSeconds: vector.now_seconds,
            ...(vector.tolerance_seconds === undefined
              ? {}
              : { toleranceSeconds: vector.tolerance_seconds }),
          }),
        );
        expect(accepted, vector.name).toBe(vector.expected === "valid");
      }
    });

    /** @scenario "The signature reproduces the published vectors byte for byte" */
    it("publishes the same header name and tolerance the vectors were generated with", () => {
      expect(vectors.headers.signature).toBe(WEBHOOK_SIGNATURE_HEADER);
      expect(vectors.default_tolerance_seconds).toBe(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
    });
  });
});

const vectorNamed = (name: string): SigningVector => {
  const found = vectors.signing.find((vector) => vector.name === name);
  if (!found) throw new Error(`the vectors no longer publish "${name}"`);
  return found;
};

describe("signWebhookPayload", () => {
  describe("given a rotation window", () => {
    /** @scenario "A rotation window signs with every valid secret, newest first" */
    it("puts the newest secret's signature first, as the published vectors do", () => {
      const rotation = vectorNamed("rotation_two_secrets");
      const newestOnly = vectorNamed("single_secret");

      const signed = signWebhookPayload({
        secrets: rotation.secrets,
        body: rotation.body,
        timestampSeconds: rotation.timestamp,
      });

      // The one-secret vector's whole header is the prefix of the rotation
      // vector's, which is what "newest first" means on the wire: a receiver
      // reading only the first `v1` follows the roll rather than lagging it.
      expect(signed.startsWith(`${newestOnly.expected_header},v1=`)).toBe(true);
      expect(signed.split(",v1=")).toHaveLength(3);
    });

    /** @scenario "A rotation window signs with every valid secret, newest first" */
    it("verifies under either secret of the window", () => {
      const rotation = vectorNamed("rotation_two_secrets");
      const signed = signWebhookPayload({
        secrets: rotation.secrets,
        body: rotation.body,
        timestampSeconds: rotation.timestamp,
      });

      for (const secret of rotation.secrets) {
        expect(
          verifyWebhookSignature({
            secret,
            body: rotation.body,
            header: signed,
            nowSeconds: rotation.timestamp,
          }),
          secret,
        ).toBe(true);
      }
    });
  });
});
