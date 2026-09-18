import { describe, expect, it } from "vitest";
import { browserSessionLabel } from "../browser-session.ts";

const CHROME_ON_MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

describe("given a session signed in from a placeable browser", () => {
  describe("when the row is read off what the browser sent", () => {
    /** @scenario A browser and a machine are read off what the browser sent */
    it("reads \"Chrome on macOS\"", () => {
      expect(browserSessionLabel(CHROME_ON_MACOS)).toBe("Chrome on macOS");
    });
  });
});

describe("given a session carrying a user agent we cannot place", () => {
  describe("when the row is read off what the browser sent", () => {
    /** @scenario Something we do not recognise is not guessed at */
    it("says the browser is unknown rather than naming one", () => {
      expect(browserSessionLabel("SomeUnrecognisedClient/1.0")).toBe("Unknown browser");
    });
  });
});
