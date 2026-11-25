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
    ])("writes %s down as a warning", (message) => {
      expect(betterAuthLogLevel({ level: "error", message })).toBe("warn");
    });

    /** @scenario "A return address better-auth refuses is written down as a warning, not an error" */
    it.each(["state_not_found", "state_mismatch", "state_invalid", "state_security_mismatch"])(
      "writes a state it could not read back with %s down as a warning",
      (code) => {
        const args = [Object.assign(new Error("state refused"), { code })];

        expect(betterAuthLogLevel({ level: "error", message: "Failed to parse state", args })).toBe(
          "warn",
        );
      },
    );
  });

  describe("when reading a sign-in's state back fails for a reason of ours", () => {
    /** @scenario "A return address better-auth refuses is written down as a warning, not an error" */
    it.each([
      [
        "a state that could not be stored",
        [Object.assign(new Error("db"), { code: "state_generation_error" })],
      ],
      ["an error that is not a state refusal", [new Error("connection refused")]],
      ["no error at all", []],
    ])("keeps %s at error", (_label, args) => {
      expect(betterAuthLogLevel({ level: "error", message: "Failed to parse state", args })).toBe(
        "error",
      );
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
