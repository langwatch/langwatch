import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { verifyWebhookSignature } from "../verify-signature.ts";

type Vector = {
  name: string;
  body: string;
  header: string;
  secrets: string[];
  now_seconds: number;
  tolerance_seconds?: number;
  expected: string;
};
type SigningVector = {
  name: string;
  body: string;
  timestamp: number;
  secrets: string[];
  expected_header: string;
};

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../../specs/webhooks/signature-vectors.json", import.meta.url),
    "utf8",
  ),
) as { verification: Vector[]; signing: SigningVector[] };

async function outcome(run: Promise<void>): Promise<string> {
  try {
    await run;
    return "valid";
  } catch (error) {
    return (error as { code?: string }).code ?? "thrown";
  }
}

describe("verifyWebhookSignature", () => {
  describe("given the published signature vectors", () => {
    /** @scenario "The verifier agrees with every published signature vector" */
    it("answers each vector's expected outcome", async () => {
      const verified = await Promise.all(
        vectors.verification.map(async (vector) => ({
          name: vector.name,
          outcome: await outcome(
            verifyWebhookSignature({
              body: vector.body,
              header: vector.header,
              secret: vector.secrets,
              nowSeconds: vector.now_seconds,
              ...(vector.tolerance_seconds === undefined
                ? {}
                : { toleranceSeconds: vector.tolerance_seconds }),
            }),
          ),
        })),
      );
      const signed = await Promise.all(
        vectors.signing.map(async (vector) => ({
          name: vector.name,
          outcome: await outcome(
            verifyWebhookSignature({
              body: vector.body,
              header: vector.expected_header,
              secret: vector.secrets,
              nowSeconds: vector.timestamp,
            }),
          ),
        })),
      );

      expect(verified).toEqual(
        vectors.verification.map((vector) => ({ name: vector.name, outcome: vector.expected })),
      );
      expect(signed).toEqual(
        vectors.signing.map((vector) => ({ name: vector.name, outcome: "valid" })),
      );
    });
  });

  describe("given a body signed the legacy sha256= way", () => {
    /** @scenario "A legacy sha256 signature verifies only when the receiver asks for that scheme" */
    it("passes under the sha256 scheme and is malformed under v1", async () => {
      const body = '{"ruleId":"rule-1"}';
      const secret = "content-marker";
      const header = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

      expect(
        await outcome(verifyWebhookSignature({ body, header, secret, scheme: "sha256" })),
      ).toBe("valid");
      expect(
        await outcome(
          verifyWebhookSignature({ body, header: "sha256=00", secret, scheme: "sha256" }),
        ),
      ).toBe("invalid_signature");
      expect(await outcome(verifyWebhookSignature({ body, header, secret }))).toBe(
        "malformed_header",
      );
    });
  });
});
