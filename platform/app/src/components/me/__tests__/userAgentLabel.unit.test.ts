/**
 * What a stored user-agent string is allowed to say about a browser.
 *
 * Spec: specs/settings/profile.feature
 */
import { describe, expect, it } from "vitest";
import {
  describeUserAgent,
  isSessionStale,
  userAgentLabel,
} from "../userAgentLabel";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("given the user agent a browser sent", () => {
  describe("when it names a browser we know", () => {
    /** @scenario A browser and a machine are read off what the browser sent */
    it("reads the browser and the machine out of it", () => {
      expect(userAgentLabel(CHROME_MAC)).toBe("Chrome on macOS");
      expect(userAgentLabel(SAFARI_MAC)).toBe("Safari on macOS");
      expect(userAgentLabel(FIREFOX_LINUX)).toBe("Firefox on Linux");
      expect(userAgentLabel(SAFARI_IPHONE)).toBe("Safari on iPhone");
    });

    /** @scenario A browser and a machine are read off what the browser sent */
    it("prefers the specific browser over the ones every Chromium claims", () => {
      // Edge says Chrome AND Safari in the same string; Chrome on Android says
      // Safari and Linux. Testing the generic names first would call all three
      // Safari, and two of them Linux.
      expect(userAgentLabel(EDGE_WINDOWS)).toBe("Edge on Windows");
      expect(userAgentLabel(CHROME_ANDROID)).toBe("Chrome on Android");
    });
  });

  describe("when it is something we cannot place", () => {
    /** @scenario Something we do not recognise is not guessed at */
    it("says the browser is unknown rather than naming the nearest one", () => {
      expect(describeUserAgent("some-internal-tool/1.0")).toEqual({
        browser: "Unknown browser",
        platform: null,
      });
      expect(userAgentLabel("some-internal-tool/1.0")).toBe("Unknown browser");
    });

    /** @scenario Something we do not recognise is not guessed at */
    it("answers the same for a session that recorded none at all", () => {
      expect(userAgentLabel(null)).toBe("Unknown browser");
      expect(userAgentLabel(undefined)).toBe("Unknown browser");
      expect(userAgentLabel("")).toBe("Unknown browser");
    });
  });
});

describe("given how long a session has been quiet", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  describe("when it did something this week", () => {
    it("is not called quiet", () => {
      expect(
        isSessionStale({ lastActiveAt: new Date("2026-08-20T12:00:00Z"), now }),
      ).toBe(false);
    });
  });

  describe("when it has done nothing for a fortnight", () => {
    /** @scenario A browser nothing has happened on for a fortnight is pointed at */
    it("is called quiet", () => {
      expect(
        isSessionStale({ lastActiveAt: new Date("2026-08-11T12:00:00Z"), now }),
      ).toBe(true);
      expect(
        isSessionStale({ lastActiveAt: new Date("2026-07-01T12:00:00Z"), now }),
      ).toBe(true);
    });
  });
});
