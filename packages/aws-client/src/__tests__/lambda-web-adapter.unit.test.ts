/**
 * Reading a buffered Lambda Web Adapter payload.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { describe, expect, it } from "vitest";

import { readLwaResponsePayload } from "../lambda-web-adapter.ts";

const SEPARATOR = "\u0000".repeat(8);

function framed(prelude: string, body: string): Uint8Array {
  return Buffer.from(`${prelude}${SEPARATOR}${body}`, "utf-8");
}

describe("readLwaResponsePayload", () => {
  describe("when the payload carries a prelude", () => {
    /** @scenario "An engine error is reported as an error" */
    it("reads the engine's own status and the body after the separator", () => {
      expect(readLwaResponsePayload(framed('{"statusCode":422}', '{"detail":"bad"}'))).toEqual({
        status: 422,
        body: '{"detail":"bad"}',
      });
    });

    /** @scenario "An empty body after the prelude stays empty" */
    it("answers an empty body rather than the prelude", () => {
      expect(readLwaResponsePayload(framed('{"statusCode":204}', ""))).toEqual({
        status: 204,
        body: "",
      });
    });

    it("leaves the status unknown when the prelude names no HTTP status", () => {
      expect(readLwaResponsePayload(framed('{"statusCode":7000}', "x")).status).toBeNull();
      expect(readLwaResponsePayload(framed("not json", "x"))).toEqual({ status: null, body: "x" });
    });
  });

  describe("when the payload carries no prelude", () => {
    /** @scenario "A response with no prelude is still read" */
    it("reads the whole payload as the body with no status of its own", () => {
      expect(readLwaResponsePayload(Buffer.from('{"result":1}'))).toEqual({
        status: null,
        body: '{"result":1}',
      });
      expect(readLwaResponsePayload(undefined)).toEqual({ status: null, body: "" });
    });
  });
});
