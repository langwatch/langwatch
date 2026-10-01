import { describe, expect, it } from "vitest";

import {
  elevenLabsLoopbackKeysSchema,
  isAllowedElevenLabsUrl,
  modelProviders,
} from "../model-provider-registry.ts";

const REFUSED_EVEN_WITH_THE_SWITCH = [
  "http://10.0.0.5:5591",
  "http://192.168.1.10:5591",
  "http://169.254.169.254:80",
  "http://169.254.169.254",
  "http://[::1]:5591",
  "http://127.0.0.2:5591",
  "http://api.elevenlabs.io",
  "http://evil.example:5591",
  "http://127.0.0.1.nip.io:5591",
  "http://localtest.me:5591",
  "http://localhost.evil.example:5591",
  "http://127.0.0.1",
  "http://localhost",
  "http://user:pass@127.0.0.1:5591",
  "ftp://127.0.0.1:5591",
  "not a url",
];

describe("isAllowedElevenLabsUrl", () => {
  /** @scenario The product reaches a loopback voice host only under the dev switch */
  describe("when the dev loopback switch is off", () => {
    it.each(["https://api.elevenlabs.io", "https://api.eu.residency.elevenlabs.io/v1"])(
      "admits %s",
      (url) => {
        expect(isAllowedElevenLabsUrl({ url, secure: "https:", allowLoopback: false })).toBe(true);
      },
    );

    it.each([
      "http://127.0.0.1:5591",
      "http://localhost:5591",
      "https://127.0.0.1:5591",
      "http://api.elevenlabs.io",
      "https://elevenlabs.io.evil.example",
      "https://user@api.elevenlabs.io",
    ])("refuses %s", (url) => {
      expect(isAllowedElevenLabsUrl({ url, secure: "https:", allowLoopback: false })).toBe(false);
    });

    it("refuses a loopback websocket", () => {
      expect(
        isAllowedElevenLabsUrl({
          url: "ws://127.0.0.1:5591/v1/convai/conversation",
          secure: "wss:",
          allowLoopback: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the dev loopback switch is on", () => {
    it.each(["http://127.0.0.1:5591", "http://localhost:5591", "https://localhost:5591/"])(
      "admits the loopback stand-in %s",
      (url) => {
        expect(isAllowedElevenLabsUrl({ url, secure: "https:", allowLoopback: true })).toBe(true);
      },
    );

    it("admits a loopback websocket with a port", () => {
      expect(
        isAllowedElevenLabsUrl({
          url: "ws://127.0.0.1:5591/v1/convai/conversation",
          secure: "wss:",
          allowLoopback: true,
        }),
      ).toBe(true);
    });

    /** @scenario The dev switch never opens anything but loopback */
    it.each(REFUSED_EVEN_WITH_THE_SWITCH)("still refuses %s", (url) => {
      expect(isAllowedElevenLabsUrl({ url, secure: "https:", allowLoopback: true })).toBe(false);
    });

    it("refuses an http loopback URL where a websocket is expected", () => {
      expect(
        isAllowedElevenLabsUrl({
          url: "http://127.0.0.1:5591",
          secure: "wss:",
          allowLoopback: true,
        }),
      ).toBe(false);
    });
  });
});

describe("the ElevenLabs keys schema", () => {
  const keys = (baseUrl: string) => ({ ELEVENLABS_API_KEY: "xi", ELEVENLABS_BASE_URL: baseUrl });

  /** @scenario The product reaches a loopback voice host only under the dev switch */
  it("refuses a loopback base URL in the registry, which never carries the switch", () => {
    expect(modelProviders.elevenlabs.keysSchema.validate(keys("http://127.0.0.1:5591"))).toBe(
      false,
    );
  });

  it("admits a loopback base URL only in the switched-on form the dev seed builds", () => {
    const seeded = elevenLabsLoopbackKeysSchema;
    expect(seeded.validate(keys("http://127.0.0.1:5591"))).toBe(true);
    expect(seeded.validate(keys("http://169.254.169.254:80"))).toBe(false);
  });

  it("still admits no base URL at all", () => {
    expect(modelProviders.elevenlabs.keysSchema.validate({ ELEVENLABS_API_KEY: "xi" })).toBe(true);
  });
});
