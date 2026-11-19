import { describe, expect, it } from "vitest";

import {
  encodePrivateEndpointsHeader,
  PRIVATE_ENDPOINTS_HEADER,
  privateEndpointsField,
  privateEndpointsHeaders,
} from "../private-model-endpoint.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

const WIRE_JSON =
  '[{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21","10.20.2.34"],"port":443}]';

/** Node's `Buffer.from(WIRE_JSON).toString("base64url")`, fixed so this lib needs no Node types. */
const WIRE_HEADER =
  "W3siaG9zdG5hbWUiOiJsbG0uaW50ZXJuYWwuYWNtZS50ZXN0IiwiYWRkcmVzc2VzIjpbIjEwLjIwLjEuMjEiLCIxMC4yMC4yLjM0Il0sInBvcnQiOjQ0M31d";

describe("the private endpoints wire contract", () => {
  describe("given an organization with one binding", () => {
    it("encodes the header as unpadded base64url of the contract JSON", () => {
      expect(encodePrivateEndpointsHeader([INFERENCE])).toBe(WIRE_HEADER);
    });

    it("names the header nlpgo reads", () => {
      expect(privateEndpointsHeaders([INFERENCE])).toEqual({
        "X-LangWatch-Private-Endpoints": WIRE_HEADER,
      });
      expect(PRIVATE_ENDPOINTS_HEADER).toBe("X-LangWatch-Private-Endpoints");
    });

    it("puts the same array in the top-level private_endpoints field", () => {
      expect(JSON.stringify(privateEndpointsField([INFERENCE]))).toBe(
        `{"private_endpoints":${WIRE_JSON}}`,
      );
    });

    it("lowercases the hostname, drops a trailing dot and keeps exactly the three fields", () => {
      const loose = { ...INFERENCE, hostname: "LLM.Internal.Acme.Test.", id: "x" };

      expect(privateEndpointsField([loose]).private_endpoints).toEqual([INFERENCE]);
    });
  });

  describe("given every padding length and multi-byte characters", () => {
    it.each([
      ["a", "W3siaG9zdG5hbWUiOiJhIiwiYWRkcmVzc2VzIjpbXSwicG9ydCI6MX1d"],
      ["ab", "W3siaG9zdG5hbWUiOiJhYiIsImFkZHJlc3NlcyI6W10sInBvcnQiOjF9XQ"],
      ["abc", "W3siaG9zdG5hbWUiOiJhYmMiLCJhZGRyZXNzZXMiOltdLCJwb3J0IjoxfV0"],
      ["abcd", "W3siaG9zdG5hbWUiOiJhYmNkIiwiYWRkcmVzc2VzIjpbXSwicG9ydCI6MX1d"],
      ["é€😀", "W3siaG9zdG5hbWUiOiLDqeKCrPCfmIAiLCJhZGRyZXNzZXMiOltdLCJwb3J0IjoxfV0"],
    ])("matches Node's base64url for %j", (hostname, expected) => {
      expect(encodePrivateEndpointsHeader([{ hostname, addresses: [], port: 1 }])).toBe(expected);
    });
  });

  describe("given an organization with no binding", () => {
    it("sends no header and no field", () => {
      expect(privateEndpointsHeaders([])).toEqual({});
      expect(privateEndpointsField([])).toEqual({});
    });
  });
});
