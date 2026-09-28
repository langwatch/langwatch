/**
 * @see specs/features/agents/voice-phone.feature
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isTwilioMediaSignatureValid,
  twilioMediaStreamUrl,
} from "../twilio-media-signature.rules.ts";

function signed({ authToken, url }: { authToken: string; url: string }): string {
  return createHmac("sha1", authToken).update(url).digest("base64");
}

describe("twilioMediaStreamUrl", () => {
  it("spells the SDK's <Stream url> for the worker's origin and the nonce", () => {
    expect(
      twilioMediaStreamUrl({ publicBaseUrl: "https://media.example.com/", nonce: "abc" }),
    ).toBe("wss://media.example.com/twilio/abc");
    expect(twilioMediaStreamUrl({ publicBaseUrl: "http://localhost:3300", nonce: "abc" })).toBe(
      "ws://localhost:3300/twilio/abc",
    );
  });
});

describe("isTwilioMediaSignatureValid", () => {
  const authToken = "twilio-auth-token";
  const streamUrl = "wss://media.example.com/twilio/abc";

  /** @scenario "The media signature is Twilio's HMAC-SHA1 of the stream URL" */
  it("accepts the base64 HMAC-SHA1 of the stream URL under the token, in either spelling", () => {
    for (const url of [streamUrl, "https://media.example.com/twilio/abc"]) {
      expect(
        isTwilioMediaSignatureValid({
          authToken,
          streamUrl,
          signature: signed({ authToken, url }),
        }),
      ).toBe(true);
    }
  });

  it("refuses another token, another URL, a missing header and a repeated one", () => {
    const refused = [
      signed({ authToken: "another-token", url: streamUrl }),
      signed({ authToken, url: "wss://elsewhere.example.com/twilio/abc" }),
      undefined,
      "",
      [signed({ authToken, url: streamUrl })],
    ];
    for (const signature of refused) {
      expect(isTwilioMediaSignatureValid({ authToken, streamUrl, signature })).toBe(false);
    }
  });
});
