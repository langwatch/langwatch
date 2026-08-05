/**
 * The already-registered refusal is a contract between the register mutation
 * and the sign-up screen: the screen keys its whole recovery flow off the code,
 * and the registry supplies the words a customer reads. Assert on `code`, never
 * on message prose; the wire message IS the code slug since #5984.
 */
import { describe, expect, it } from "vitest";

import { resolveErrorCopy } from "~/features/errors";
import { EmailAlreadyRegisteredError } from "../errors";

describe("EmailAlreadyRegisteredError", () => {
  describe("when the server refuses a sign-up for an email that has an account", () => {
    /** @scenario "The refusal carries a code the screen can act on" */
    it("carries the email_already_registered code and customer-read wording", () => {
      const error = new EmailAlreadyRegisteredError();

      expect(error.code).toBe("email_already_registered");
      expect(error.httpStatus).toBe(409);
      expect(error.fault).toBe("customer");

      // The words a customer actually reads come from the code-keyed registry,
      // resolved from the serialized shape the way the client would.
      const copy = resolveErrorCopy({
        error: { data: { error: error.serialize() } },
      });
      expect(copy.title.toLowerCase()).toContain("already has an account");
      expect(copy.description.toLowerCase()).toContain("sign in");
      expect(copy.description.toLowerCase()).toContain("reset");
    });
  });
});
