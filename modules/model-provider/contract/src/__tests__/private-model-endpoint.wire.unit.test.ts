import { describe, expect, it } from "vitest";

import {
  PRIVATE_ENDPOINTS_HEADER,
  PRIVATE_ENDPOINTS_PROJECT_HEADER,
  privateEndpointsField,
  signPrivateEndpointsHeaders,
} from "../private-model-endpoint.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

const WIRE_JSON =
  '[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]';

/**
 * The vector nlpgo's verifier is held to too (aigateway/domain/private_endpoint_envelope_test.go):
 * seed 0x01..0x20, acme-prod, signed at 1800000000 for 900 seconds. Ed25519 is deterministic, so
 * the value is exact. The seed is built, not written out, so the source carries no key material.
 */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SEED_BYTES = Array.from({ length: 32 }, (_, i) => i + 1);
const SEED_BITS = SEED_BYTES.map((byte) => byte.toString(2).padStart(8, "0")).join("");
const SHARED_SEED = (SEED_BITS.match(/.{1,6}/g) ?? [])
  .map((sextet) => BASE64[parseInt(sextet.padEnd(6, "0"), 2)])
  .join("");
const SHARED_HEADER =
  "eyJ2IjoxLCJvcmdhbml6YXRpb25JZCI6Im9yZ19hY21lIiwicHJvamVjdElkIjoiYWNtZS1wcm9kIiwiYmluZGluZ3MiOlt7Imhvc3RuYW1lIjoibGxtLmludGVybmFsLmFjbWUudGVzdCIsImFkZHJlc3NlcyI6WyIxMC4yMC4xLjIxIiwiMTAuMjAuMi4zNCJdLCJwb3J0Ijo0NDN9XSwiZXhwaXJlc0F0IjoxODAwMDAwOTAwfQ.oyQyB4gk0jXh3oyefY_wDJ4rK1h1zu6ZKDwOTXbtNi3KFSIRCAJpo5WqzvoY79_eppAlLxm4e1dD7iaGwKB4CQ";

function sign(overrides: Partial<Parameters<typeof signPrivateEndpointsHeaders>[0]> = {}) {
  return signPrivateEndpointsHeaders({
    organizationId: "org_acme",
    projectId: "acme-prod",
    bindings: [INFERENCE],
    signingKey: SHARED_SEED,
    ttlSeconds: 900,
    now: 1_800_000_000_000,
    ...overrides,
  });
}

describe("the private endpoints wire contract", () => {
  describe("given an organization with one binding", () => {
    /** @scenario "The app's signed envelope verifies in nlpgo byte for byte" */
    it("signs the envelope exactly as nlpgo verifies it", async () => {
      expect(await sign()).toEqual({
        [PRIVATE_ENDPOINTS_HEADER]: SHARED_HEADER,
        [PRIVATE_ENDPOINTS_PROJECT_HEADER]: "acme-prod",
      });
      expect(PRIVATE_ENDPOINTS_HEADER).toBe("X-LangWatch-Private-Endpoints");
      expect(PRIVATE_ENDPOINTS_PROJECT_HEADER).toBe("X-LangWatch-Project-Id");
    });

    it("reads the seed in either base64 alphabet, padded or not", async () => {
      const urlSafe = SHARED_SEED.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      expect(await sign({ signingKey: urlSafe })).toEqual(await sign());
    });

    it("lowercases the hostname, drops a trailing dot and keeps exactly the three fields", async () => {
      const loose = { ...INFERENCE, hostname: "LLM.Internal.Acme.Test.", id: "x" };

      expect(await sign({ bindings: [loose] })).toEqual(await sign());
      expect(privateEndpointsField([loose]).private_endpoints).toEqual([INFERENCE]);
    });

    it("puts the array in the gateway bundle's private_endpoints field", () => {
      expect(JSON.stringify(privateEndpointsField([INFERENCE]))).toBe(
        `{"private_endpoints":${WIRE_JSON}}`,
      );
    });
  });

  describe("given a signing key that is not a 32-byte seed", () => {
    it("refuses to sign", async () => {
      await expect(sign({ signingKey: "c2hvcnQ=" })).rejects.toThrow(
        "LANGWATCH_PRIVATE_ENDPOINTS_SIGNING_KEY",
      );
    });
  });

  describe("given an organization with no binding", () => {
    it("sends no header and no field", async () => {
      expect(await sign({ bindings: [] })).toEqual({});
      expect(privateEndpointsField([])).toEqual({});
    });
  });
});
