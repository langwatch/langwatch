/**
 * A delete Langy asked for before the person clicked Yes comes back 409
 * `langy_confirmation_required`, and the platform's sentence is what tells Langy to wait for the
 * click and run the command again. The CLI must print that sentence as the platform wrote it.
 * @see specs/langy/langy-delete-confirmation.feature
 */
import { describe, expect, it } from "vitest";

import { formatApiErrorForOperation } from "../../../client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "../../../client-sdk/services/_shared/throw-handled-error";
import { readCommandError, renderErrorForHumans } from "../errorOutput";

const SENTENCE =
  'Deleting needs a confirmation click. A confirmation card for evaluator "Toxicity check" is ' +
  "now shown to the user. Wait for their answer; after they choose Yes, run the same command again.";

/** The canonical REST envelope the platform answers the refused delete with. */
const BODY = {
  type: "conflict",
  code: "langy_confirmation_required",
  message: SENTENCE,
  retryable: false,
  meta: { resource: "evaluator", action: "delete" },
};

/** What a service's delete throws for that body, as the evaluator service builds it. */
function thrownByService(): unknown {
  const operation = 'delete evaluator with ID "ev_1"';
  try {
    throwIfHandledError({
      operation,
      error: BODY,
      status: 409,
      message: formatApiErrorForOperation({ operation, error: BODY, options: { status: 409 } }),
    });
  } catch (error) {
    return error;
  }
  throw new Error("the refusal was not read as a handled error");
}

describe("a delete refused for want of a confirmation click", () => {
  describe("when the CLI prints the refusal", () => {
    it("keeps the platform's sentence word for word and names the code", () => {
      const domain = readCommandError(thrownByService());
      const printed = renderErrorForHumans(domain);

      expect(domain.code).toBe("langy_confirmation_required");
      expect(printed).toContain(SENTENCE);
    });
  });
});
