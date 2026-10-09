import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAXIMUM_BYTES,
  PASSWORD_MINIMUM_LENGTH,
  passwordProblem,
} from "../password-policy";

/**
 * The rules the sign-up form and the mutation behind it both read. What is
 * being pinned is that ONE answer exists — the two sides ask this and nothing
 * else, so a password either side accepts is one both accept.
 */
describe("the password policy", () => {
  describe("when a password is long enough", () => {
    it("has nothing to say about it", () => {
      expect(passwordProblem("a-good-password")).toBeNull();
      expect(passwordProblem("x".repeat(PASSWORD_MINIMUM_LENGTH))).toBeNull();
    });
  });

  describe("when a password is too short", () => {
    it("says how long it has to be, rather than which rule fired", () => {
      const problem = passwordProblem("x".repeat(PASSWORD_MINIMUM_LENGTH - 1));

      expect(problem).toBe(`Use at least ${PASSWORD_MINIMUM_LENGTH} characters`);
    });
  });

  describe("when a password is longer than bcrypt reads", () => {
    it("refuses it rather than silently keeping the first 72 bytes", () => {
      // Two passwords differing only past the limit would otherwise BOTH open
      // the account, because the hash never saw the difference.
      expect(passwordProblem("x".repeat(PASSWORD_MAXIMUM_BYTES + 1))).toBe(
        `Use at most ${PASSWORD_MAXIMUM_BYTES} characters`,
      );
    });

    it("counts bytes, so a short-looking password can still be over", () => {
      // Every one of these is four bytes: 20 of them are 80.
      expect(passwordProblem("🔑".repeat(20))).toBe(
        `Use at most ${PASSWORD_MAXIMUM_BYTES} characters`,
      );
      expect(passwordProblem("🔑".repeat(10))).toBeNull();
    });
  });

  describe("when a password is nothing but spaces", () => {
    it("refuses it, however many there are", () => {
      expect(passwordProblem(" ".repeat(PASSWORD_MINIMUM_LENGTH + 4))).toBe(
        "Use at least one character that is not a space",
      );
    });

    it("allows spaces inside one, because a passphrase has them", () => {
      expect(passwordProblem("correct horse battery")).toBeNull();
    });
  });
});
