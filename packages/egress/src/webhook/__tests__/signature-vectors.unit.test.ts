import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeVectors, VECTORS_RELATIVE_PATH } from "../signature-vectors";

/**
 * The drift check the generator's own documentation has always promised and
 * never had.
 *
 * Three suites — this package's, the TypeScript SDK's and the Python SDK's —
 * assert against the committed `specs/webhooks/signature-vectors.json`. All
 * three keep passing when the signing code changes and the file does not,
 * because they compare a verifier against a fixture rather than against the
 * signer. This is the one assertion that ties the fixture back to the code it
 * claims to have come from.
 */
describe("given the committed webhook signature vectors", () => {
  describe("when the signing code is asked to produce them again", () => {
    it("writes byte for byte what is committed", () => {
      const committed = readFileSync(
        resolve(import.meta.dirname, "../../../../..", VECTORS_RELATIVE_PATH),
        "utf8",
      );

      expect(serializeVectors()).toBe(committed);
    });
  });
});
