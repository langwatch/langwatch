/**
 * The TypeScript verifier, held to the sender's own arithmetic.
 *
 * The cases are not written here. They are read from
 * `specs/webhooks/signature-vectors.json`, which is generated from the
 * server's signing code by
 * `platform/app/src/tasks/generateWebhookSignatureVectors.ts` and asserted
 * against that code by a suite on the platform side. Three implementations
 * agreeing with their own local idea of the algorithm is not agreement, so
 * this suite and the Python one read the SAME file and neither can be made
 * green by editing it.
 *
 * Spec: specs/webhooks/sdk-signature-verification.feature
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  verifyWebhookSignature,
  WebhookSignatureVerificationError,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookSignatureFailureCode,
} from "../verify-signature";

/** Repo root, seven levels up from `src/client-sdk/services/webhooks/__tests__`. */
const VECTORS_PATH = join(
  __dirname,
  "../../../../../../..",
  "specs/webhooks/signature-vectors.json",
);

interface VerificationVector {
  name: string;
  why: string;
  body: string;
  header: string;
  secrets: string[];
  now_seconds: number;
  tolerance_seconds?: number;
  expected: "valid" | WebhookSignatureFailureCode;
}

interface SigningVector {
  name: string;
  body: string;
  timestamp: number;
  secrets: string[];
  expected_header: string;
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as {
  default_tolerance_seconds: number;
  headers: { signature: string; delivery_id: string; event_id: string };
  signing: SigningVector[];
  verification: VerificationVector[];
};

/** Runs the verifier and reports what a receiver would have concluded. */
const outcomeOf = (candidate: VerificationVector): string => {
  try {
    verifyWebhookSignature({
      body: candidate.body,
      header: candidate.header,
      secret: candidate.secrets,
      nowSeconds: candidate.now_seconds,
      ...(candidate.tolerance_seconds !== undefined
        ? { toleranceSeconds: candidate.tolerance_seconds }
        : {}),
    });
    return "valid";
  } catch (error) {
    if (error instanceof WebhookSignatureVerificationError) return error.code;
    throw error;
  }
};

/** One generated case by name, so a scenario reads as the case it is about. */
const vector = (name: string): VerificationVector => {
  const found = vectors.verification.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no signature vector named ${name}`);
  return found;
};

describe("Feature: verifying a LangWatch webhook delivery", () => {
  it("defaults to the tolerance the sender documents", () => {
    expect(WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS).toBe(
      vectors.default_tolerance_seconds,
    );
  });

  it("names the headers the sender actually sets", () => {
    // Hand-copied header names are how a receiver ends up keying idempotency
    // off a header that no longer exists, processing every retry twice.
    expect(WEBHOOK_SIGNATURE_HEADER).toBe(vectors.headers.signature);
    expect(WEBHOOK_DELIVERY_ID_HEADER).toBe(vectors.headers.delivery_id);
    expect(WEBHOOK_EVENT_ID_HEADER).toBe(vectors.headers.event_id);
  });

  it("reads a vector file that actually carries cases", () => {
    // A path typo would otherwise make an empty describe.each read as green.
    expect(vectors.verification.length).toBeGreaterThan(15);
    expect(vectors.signing.length).toBeGreaterThan(3);
  });

  describe("given the vectors generated from the sender", () => {
    describe.each(vectors.verification)(
      "when the delivery is $name",
      (vector: VerificationVector) => {
        /** @scenario Both SDK verifiers reach the sender's verdict on every generated case */
        it(`concludes ${vector.expected} because ${vector.why}`, () => {
          expect(outcomeOf(vector)).toBe(vector.expected);
        });
      },
    );

    /** @scenario Both SDK verifiers reach the sender's verdict on every generated case */
    it("exercises all four verdicts rather than only the happy one", () => {
      const judged = new Set(vectors.verification.map(outcomeOf));
      expect([...judged].sort()).toEqual([
        "invalid_signature",
        "malformed_header",
        "stale_timestamp",
        "valid",
      ]);
    });
  });

  describe("when the delivery is signed with the secret the receiver holds", () => {
    /** @scenario A delivery signed with a secret the receiver holds is accepted */
    it("accepts it so the handler may act on the body", () => {
      expect(outcomeOf(vector("valid_single_secret"))).toBe("valid");
    });
  });

  describe("when the body was altered after signing", () => {
    /** @scenario A body changed in transit is refused as a bad signature */
    it("refuses it as a signature mismatch, not as a stale delivery", () => {
      expect(outcomeOf(vector("invalid_signature_tampered_body"))).toBe(
        "invalid_signature",
      );
    });
  });

  describe("when a correctly signed delivery arrives long after it was signed", () => {
    /** @scenario A delivery outside the freshness window is refused as stale */
    it("refuses it as stale, which reads as a clock or a replay", () => {
      expect(outcomeOf(vector("stale_timestamp_in_the_past"))).toBe("stale_timestamp");
    });
  });

  describe("when the header is not the signature scheme at all", () => {
    /** @scenario A signature header the receiver cannot parse is refused as malformed */
    it("refuses it as malformed rather than guessing at the format", () => {
      expect(outcomeOf(vector("malformed_header_garbage"))).toBe("malformed_header");
    });
  });

  describe("when the sender is mid secret rotation", () => {
    /** @scenario During a secret rotation either secret the receiver holds verifies the delivery */
    it("accepts the delivery whichever of the two secrets the receiver holds", () => {
      // The header carries one signature per valid secret. All three
      // receivers below must take delivery, or a rotation drops traffic.
      expect(outcomeOf(vector("valid_rotation_receiver_holds_new_only"))).toBe("valid");
      expect(outcomeOf(vector("valid_rotation_receiver_holds_old_only"))).toBe("valid");
      expect(outcomeOf(vector("valid_rotation_receiver_holds_both"))).toBe("valid");
    });
  });

  describe("when the receiver holds one secret rather than a list", () => {
    it("takes a bare string, which is the ordinary steady-state call", () => {
      const single = vector("valid_single_secret");
      expect(() =>
        verifyWebhookSignature({
          body: single.body,
          header: single.header,
          secret: single.secrets[0]!,
          nowSeconds: single.now_seconds,
        }),
      ).not.toThrow();
    });
  });

  describe("when the body arrives as raw bytes", () => {
    /** @scenario The exact bytes received are what gets verified */
    it("verifies a Buffer exactly as it verifies the same string", () => {
      // Frameworks hand a receiver a Buffer; re-encoding it would be the
      // very mistake the helper exists to prevent.
      const unicode = vector("valid_unicode_body");
      expect(() =>
        verifyWebhookSignature({
          body: Buffer.from(unicode.body, "utf8"),
          header: unicode.header,
          secret: unicode.secrets,
          nowSeconds: unicode.now_seconds,
        }),
      ).not.toThrow();
    });
  });

  describe("when the receiver was configured without a secret", () => {
    /** @scenario A receiver with no secret configured is told its configuration is wrong */
    it("blames the configuration rather than reporting a forged delivery", () => {
      const good = vector("valid_single_secret");
      // A receiver that lost its secret must not read as "every delivery is
      // being tampered with", which is what an invalid_signature would say.
      expect(() =>
        verifyWebhookSignature({
          body: good.body,
          header: good.header,
          secret: ["", ""],
          nowSeconds: good.now_seconds,
        }),
      ).toThrow(TypeError);
    });
  });

  describe("when no clock is supplied", () => {
    it("judges freshness against the system clock", () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const stale = vector("valid_single_secret");
      // The vector's timestamp is fixed in the past, so with the real clock
      // the same delivery must now read as stale.
      try {
        verifyWebhookSignature({
          body: stale.body,
          header: stale.header,
          secret: stale.secrets,
        });
        throw new Error("expected the delivery to be judged stale");
      } catch (error) {
        expect(error).toBeInstanceOf(WebhookSignatureVerificationError);
        expect((error as WebhookSignatureVerificationError).code).toBe("stale_timestamp");
      }
      expect(nowSeconds).toBeGreaterThan(stale.now_seconds);
    });
  });
});
