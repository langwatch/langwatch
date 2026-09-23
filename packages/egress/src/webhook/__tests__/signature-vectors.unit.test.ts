import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { serializeVectors, VECTORS_RELATIVE_PATH } from "../signature-vectors.ts";

/**
 * Ties the committed `specs/webhooks/signature-vectors.json` fixture back to the signer:
 * this package's, the TS SDK's and the Python SDK's suites all assert against the fixture,
 * not the signer, so all three keep passing even as the signer drifts from it.
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
