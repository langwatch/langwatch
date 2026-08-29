/** @vitest-environment node */

/**
 * Every refusal the single sign-on onboarding surfaces can produce, and what
 * a customer actually reads when one arrives.
 *
 * Corresponds to specs/identity/sso-onboarding-tiers.feature.
 *
 * The trap this guards is #5984's: since the tRPC boundary replaces a handled
 * error's wire message with its CODE, a surface that renders `error.message`
 * shows the reader `sso_saml_not_self_serve`. So the assertion is not that a
 * code exists — it is that the words registered for the code are words, and
 * that they are what a renderer would reach.
 */
import {
  SsoConnectionActivationBlockedError,
  SsoConnectionDomainTakenError,
  SsoConnectionInvalidTransitionError,
  SsoConnectionOperatorActRequiredError,
  SsoConnectionStringEditRetiredError,
  SsoConnectionTeardownStrandsUsersError,
  SsoSamlNotSelfServeError,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import {
  explainAnyError,
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors/logic/presentation";

/**
 * Every refusal reachable from the onboarding surfaces, constructed the way
 * the guards construct them. Listed rather than derived so that adding a
 * refusal without copy is a failing test rather than a silent gap.
 */
const REFUSALS = [
  new SsoConnectionInvalidTransitionError("detail"),
  new SsoConnectionDomainTakenError("detail"),
  new SsoConnectionActivationBlockedError("detail"),
  new SsoConnectionTeardownStrandsUsersError("detail"),
  new SsoConnectionOperatorActRequiredError("detail"),
  new SsoConnectionStringEditRetiredError("detail"),
  new SsoSamlNotSelfServeError("detail"),
];

const shapeOf = (error: (typeof REFUSALS)[number]) => ({
  code: error.code,
  meta: error.meta,
  httpStatus: error.httpStatus,
  fault: error.fault,
  tips: error.tips,
  docsUrl: error.docsUrl,
  traceId: error.traceId,
  reasons: [],
});

describe("refusals on the single sign-on onboarding surfaces", () => {
  describe("when a step is refused for a reason we can name", () => {
    /** @scenario "Every refusal on these surfaces carries a code and words written for a customer" */
    it.each(
      REFUSALS.map((error) => [error.code, error] as const),
    )("%s carries a stable code and registered words, never the code and never unknown", (code, error) => {
      // A stable code, and the message on the error is the code — which is
      // exactly what the wire carries, and exactly what must never be shown.
      expect(error.code).toBe(code);
      expect(error.message).toBe(code);

      const copy = explainHandledError(shapeOf(error));

      expect(copy.isRegistered).toBe(true);
      // The words the reader sees are the ones registered for the code.
      expect(copy.title).not.toContain(code);
      expect(copy.title).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
      expect(copy.title).not.toBe(UNKNOWN_ERROR_PRESENTATION.title);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.description).not.toContain(code);
      expect(copy.description).not.toBe(UNKNOWN_ERROR_PRESENTATION.description);
    });

    it("never leaks the logged detail into what the customer reads", () => {
      // The detail rides in `reasons` for the log line. Nothing in the copy
      // for a code can reach it, because `describe()` is only handed `meta`.
      const error = new SsoConnectionDomainTakenError(
        "domain acme.com is already verified on connection ssoc_first",
      );
      const copy = explainHandledError(shapeOf(error));

      expect(copy.description).not.toContain("ssoc_first");
      expect(copy.description).not.toContain("acme.com");
    });
  });

  describe("when a step fails for a reason nobody anticipated", () => {
    /** @scenario "A failure we cannot name degrades honestly and stays traceable" */
    it("says it did not work, invents no cause, and leaves something to quote", () => {
      // A plain Error is what an unanticipated failure is — an infrastructure
      // fault dressed up as a handled one would promise the reader an action
      // they do not have.
      const unanticipated = new Error(
        "connect ECONNREFUSED 10.0.3.14:5432 while appending",
      );
      const copy = explainAnyError(unanticipated);

      expect(copy).toEqual(UNKNOWN_ERROR_PRESENTATION);
      expect(copy.isRegistered).toBe(false);
      // Told that it did not work...
      expect(copy.title).toBe("Something went wrong");
      // ...with no invented cause the reader could act on.
      expect(copy.description).not.toContain("ECONNREFUSED");
      expect(copy.description).not.toContain("10.0.3.14");
      expect(copy.description).not.toMatch(/database|postgres|network/i);

      // And a handled refusal still carries the trace id, so a reader who
      // needs to quote something back to us has it.
      const named = new SsoConnectionActivationBlockedError("detail");
      expect(named).toHaveProperty("traceId");
    });
  });
});
