/**
 * Reading a buffered Lambda Web Adapter payload, and which invoke failures may be retried.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { describe, expect, it } from "vitest";

import { readLwaResponsePayload } from "../lambda-web-adapter-stream.rules.ts";
import { invokeNeverStarted, invokeRetryDelayMs } from "../nlp-lambda-invoke-retry.rules.ts";

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

describe("invokeNeverStarted", () => {
  /** @scenario "An invoke the service rejected before running is retried" */
  it("is true for a throttle from the control plane", () => {
    const throttle = Object.assign(new Error("Rate Exceeded."), {
      name: "TooManyRequestsException",
    });
    expect(invokeNeverStarted(throttle)).toBe(true);
  });

  /** @scenario "An invoke that never reached the service is retried" */
  it("is true for a connection that was never established, on the error or its cause", () => {
    expect(invokeNeverStarted(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(
      true,
    );
    expect(invokeNeverStarted(new Error("fetch failed", { cause: { code: "ENOTFOUND" } }))).toBe(
      true,
    );
  });

  /** @scenario "An invoke that may have started the function is not retried" */
  it("is false for a failure that may have reached the function", () => {
    expect(invokeNeverStarted(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(
      false,
    );
    expect(invokeNeverStarted(Object.assign(new Error("boom"), { name: "ServiceException" }))).toBe(
      false,
    );
    expect(invokeNeverStarted(null)).toBe(false);
  });

  it("backs off doubling from 500ms up to an 8s ceiling", () => {
    expect([1, 2, 3, 4, 5, 6].map(invokeRetryDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
});
