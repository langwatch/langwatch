/**
 * The refusal a sign-up gets when the address already has an account, and the
 * words a customer reads for it.
 * @see specs/auth/signup-does-not-strand-an-account.feature
 */
import { APP_ERROR_CODES } from "@langwatch/handled-error/app-codes";
import { describe, expect, it } from "vitest";
import { EmailAlreadyRegisteredError } from "../user.errors.ts";

describe("the sign-up refusal for an address that already has an account", () => {
  describe("given the server refused a sign-up", () => {
    /** The screen retries the sign-in itself and then offers a reset, and it
     *  keys both off the code — never off the message.
     *  @scenario "The refusal carries a code the screen can act on" */
    it("carries the code, the conflict status and a customer fault", () => {
      const error = new EmailAlreadyRegisteredError();

      expect(error.code).toBe("email_already_registered");
      expect(error.httpStatus).toBe(409);
      expect(error.fault).toBe("customer");
    });

    /** The code travels on the wire, and it is an ENUMERATED one — which is
     *  what makes the client presentation registry exhaustive over it, so the
     *  screen has words for this refusal rather than the generic line.
     *  @scenario "The refusal carries a code the screen can act on" */
    it("puts that code on the wire, from the enumerated set the registry covers", () => {
      const serialized = new EmailAlreadyRegisteredError().serialize();

      expect(serialized).toMatchObject({ code: "email_already_registered" });
      expect(APP_ERROR_CODES).toContain("email_already_registered");
    });
  });
});
