/** @see specs/auth/signin-callback-url-unsupported-characters.feature */
import { describe, expect, it } from "vitest";

import { betterAuthLogLevel } from "../http.better-auth.channel.ts";

describe("betterAuthLogLevel", () => {
  describe("when better-auth reports a refusal the caller is answered for", () => {
    /** @scenario "A return address better-auth refuses is written down as a warning, not an error" */
    it.each([
      "Invalid callbackURL: /a#frag",
      "Invalid errorCallbackURL: https://evil.example",
      "Invalid newUserCallbackURL: /a:b",
      "Invalid redirectURL: /a~b",
      "Failed to parse state",
    ])("writes %s down as a warning", (message) => {
      expect(betterAuthLogLevel({ level: "error", message })).toBe("warn");
    });
  });

  describe("when better-auth reports any other failure", () => {
    /** @scenario "A return address better-auth refuses is written down as a warning, not an error" */
    it.each(["Invalid origin: https://evil.example", "Failed to create user"])(
      "keeps %s at error",
      (message) => {
        expect(betterAuthLogLevel({ level: "error", message })).toBe("error");
      },
    );

    it("keeps its own warn and folds everything quieter to info", () => {
      expect(betterAuthLogLevel({ level: "warn", message: "x" })).toBe("warn");
      expect(betterAuthLogLevel({ level: "debug", message: "x" })).toBe("info");
      expect(betterAuthLogLevel({ level: "info", message: "x" })).toBe("info");
    });
  });
});
