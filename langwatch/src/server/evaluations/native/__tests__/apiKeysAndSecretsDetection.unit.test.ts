import { describe, expect, it } from "vitest";
import { evaluateApiKeysAndSecrets } from "../apiKeysAndSecretsDetection";

describe("evaluateApiKeysAndSecrets", () => {
  describe("given content with a leaked provider key", () => {
    /** @scenario The secrets evaluator flags a leaked key in trace content */
    it("fails with a count and a per-rule summary", () => {
      const result = evaluateApiKeysAndSecrets({
        input:
          "here is my key sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY thanks",
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(false);
      expect(result.score).toBe(1);
      expect(result.details).toContain("provider_api_key");
    });
  });

  describe("given a secret hiding in a mapped custom attribute (not input/output)", () => {
    /** @scenario The secrets evaluator scans every mapped field */
    it("still detects it by scanning every string field", () => {
      const result = evaluateApiKeysAndSecrets({
        "app.debug.headers": { authorization: "AKIAIOSFODNN7EXAMPLE" },
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(false);
      expect(result.score).toBe(1);
    });
  });

  describe("given clean content", () => {
    /** @scenario Clean content passes the secrets evaluator */
    it("passes with score zero", () => {
      const result = evaluateApiKeysAndSecrets({
        input: "the user asked about the weather",
        output: "it is sunny today",
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(true);
      expect(result.score).toBe(0);
    });
  });

  describe("given content where the secret was already redacted to [SECRET]", () => {
    it("finds no live secret (the augmenter adds the marker back)", () => {
      const result = evaluateApiKeysAndSecrets({
        input: "authorization: [SECRET]",
      });
      expect(result.status).toBe("processed");
      if (result.status !== "processed") return;
      expect(result.passed).toBe(true);
      expect(result.score).toBe(0);
    });
  });
});
