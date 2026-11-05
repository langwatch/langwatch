/**
 * Signatures here are synthetic: computed in the test with node:crypto from made-up tokens and
 * URLs. They are not a recorded Twilio handshake.
 * @see specs/features/agents/voice-media-claim.feature
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isValidTwilioSignature, twilioSignatureUrlVariants } from "../twilio-signature.rules.ts";

const AUTH_TOKEN = "synthetic-auth-token";
const STREAM_URL = "wss://media.example.test/twilio/run-1/nonce-1";

function sign({ authToken, url }: { authToken: string; url: string }): string {
  return createHmac("sha1", authToken).update(url).digest("base64");
}

describe("twilioSignatureUrlVariants", () => {
  describe("given a wss URL", () => {
    it("starts with the URL as given", () => {
      expect(twilioSignatureUrlVariants(STREAM_URL)[0]).toBe(STREAM_URL);
    });

    it.each([
      ["the https spelling", "https://media.example.test/twilio/run-1/nonce-1"],
      ["a trailing slash", "wss://media.example.test/twilio/run-1/nonce-1/"],
      ["the explicit default port", "wss://media.example.test:443/twilio/run-1/nonce-1"],
      [
        "https with the explicit default port",
        "https://media.example.test:443/twilio/run-1/nonce-1",
      ],
      ["https with a trailing slash", "https://media.example.test/twilio/run-1/nonce-1/"],
    ])("includes %s", (_label, variant) => {
      expect(twilioSignatureUrlVariants(STREAM_URL)).toContain(variant);
    });
  });

  describe("given a ws URL with the explicit default port", () => {
    it.each([
      ["without the port", "ws://localhost/twilio/run-1/nonce-1"],
      ["the http spelling", "http://localhost:80/twilio/run-1/nonce-1"],
    ])("includes %s", (_label, variant) => {
      expect(twilioSignatureUrlVariants("ws://localhost:80/twilio/run-1/nonce-1")).toContain(
        variant,
      );
    });
  });

  describe("given a URL on a non-default port", () => {
    it("keeps the port in every variant", () => {
      const variants = twilioSignatureUrlVariants("ws://localhost:3300/twilio/run-1/nonce-1");

      expect(variants.every((variant) => variant.includes(":3300"))).toBe(true);
    });
  });
});

describe("isValidTwilioSignature", () => {
  describe("given the HMAC-SHA1 of the stream URL under the token", () => {
    /** @scenario "The media signature is Twilio's HMAC-SHA1 of the stream URL" */
    it("accepts it", () => {
      const signature = sign({ authToken: AUTH_TOKEN, url: STREAM_URL });

      expect(isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature })).toBe(
        true,
      );
    });
  });

  describe("given a signature over another spelling of the URL", () => {
    /** @scenario "The signature is accepted for any spelling Twilio may have signed" */
    it.each([
      "https://media.example.test/twilio/run-1/nonce-1",
      "wss://media.example.test/twilio/run-1/nonce-1/",
      "wss://media.example.test:443/twilio/run-1/nonce-1",
      "https://media.example.test:443/twilio/run-1/nonce-1/",
    ])("accepts %s", (signedUrl) => {
      const signature = sign({ authToken: AUTH_TOKEN, url: signedUrl });

      expect(isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature })).toBe(
        true,
      );
    });
  });

  describe("given a signature under another account's token", () => {
    /** @scenario "A signature under another account's token is refused" */
    it("refuses it", () => {
      const signature = sign({ authToken: "another-token", url: STREAM_URL });

      expect(isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature })).toBe(
        false,
      );
    });
  });

  describe("given a signature for another host's URL", () => {
    /** @scenario "A signature for another host's URL is refused" */
    it("refuses it", () => {
      const signature = sign({
        authToken: AUTH_TOKEN,
        url: "wss://elsewhere.example.test/twilio/run-1/nonce-1",
      });

      expect(isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature })).toBe(
        false,
      );
    });
  });

  describe("given a tampered path", () => {
    it("refuses the signature of the original", () => {
      const signature = sign({ authToken: AUTH_TOKEN, url: STREAM_URL });

      expect(
        isValidTwilioSignature({
          authToken: AUTH_TOKEN,
          url: "wss://media.example.test/twilio/run-1/nonce-2",
          signature,
        }),
      ).toBe(false);
    });
  });

  describe("given an empty signature", () => {
    /** @scenario "A missing or empty signature is refused" */
    it("refuses it", () => {
      expect(
        isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature: "" }),
      ).toBe(false);
    });
  });

  describe("given a signature that is not base64 of the right length", () => {
    it("refuses it without throwing", () => {
      expect(
        isValidTwilioSignature({ authToken: AUTH_TOKEN, url: STREAM_URL, signature: "!!short" }),
      ).toBe(false);
    });
  });
});
