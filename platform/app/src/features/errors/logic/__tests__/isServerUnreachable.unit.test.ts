import { describe, expect, it } from "vitest";

import { isServerUnreachable } from "../isServerUnreachable";

/**
 * The one distinction the error surface makes before it reaches for the
 * registry: did anything answer? Our copy for an unrecognised failure
 * promises "we've been notified", and a request that never left the browser
 * notified nobody.
 */
describe("given a failure that never reached the server", () => {
  describe("when the browser says the fetch did not complete", () => {
    it("recognises each engine's way of saying it", () => {
      for (const message of [
        "Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "fetch failed",
      ]) {
        expect(isServerUnreachable(new Error(message))).toBe(true);
      }
    });

    it("recognises it on a plain tRPC-shaped object too", () => {
      expect(isServerUnreachable({ message: "Failed to fetch" })).toBe(true);
    });
  });
});

describe("given a failure the server answered with", () => {
  describe("when it carries an HTTP status", () => {
    it("is reachable, whatever the message happens to say", () => {
      // The message alone would match. The status is what settles it: a
      // server that refused is a server that is up, and calling that a
      // network blip hides a fault we could have named.
      expect(
        isServerUnreachable({
          message: "Failed to fetch",
          data: { httpStatus: 500 },
        }),
      ).toBe(false);
    });
  });

  describe("when it carries an error code", () => {
    it("is reachable", () => {
      expect(
        isServerUnreachable({
          message: "load failed",
          data: { code: "INTERNAL_SERVER_ERROR" },
        }),
      ).toBe(false);
    });
  });

  describe("when it is an ordinary refusal", () => {
    it("is left to the registry", () => {
      expect(
        isServerUnreachable({
          message: "validation_error",
          data: { httpStatus: 400, code: "BAD_REQUEST" },
        }),
      ).toBe(false);
    });
  });
});

describe("given no failure at all", () => {
  it("answers false rather than guessing", () => {
    expect(isServerUnreachable(null)).toBe(false);
    expect(isServerUnreachable(undefined)).toBe(false);
    expect(isServerUnreachable({})).toBe(false);
  });
});
