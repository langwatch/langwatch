/** @vitest-environment node */

/**
 * Every refusal a person can meet on the way into an organization reaches
 * them as WORDS (D12).
 *
 * The failure this guards is specific and has already happened once, in
 * #5984: the wire message for a handled error IS the code slug, so a screen
 * that rendered `error.message` showed somebody `join_auto_domain_unproven`
 * and nothing else. So this drives the real chain — the real error, through
 * the real tRPC `errorFormatter`, through the real client resolver — and
 * asserts on what a reader would actually see.
 *
 * Spec: specs/identity/join-requests.feature
 */
import {
  JoinAutoConnectionAdmitsError,
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  JoinNotAvailableError,
  JoinRequestAlreadyPendingError,
  JoinRequestNotFoundError,
  JoinRequestNotPendingError,
  JoinRequestThrottledError,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";

import { errorFormatter } from "~/server/api/trpc";
import { resolveErrorCopy } from "../resolveErrorCopy";

/** Every refusal this deliverable can produce, built the way the services
 *  build them — including the internal detail each one carries for the log. */
const REFUSALS = [
  new JoinNotAvailableError("organization org_secret is not open to acme.com"),
  new JoinRequestNotFoundError("jreq_1 does not belong to org_acme"),
  new JoinRequestNotPendingError("jreq_1 is APPROVED"),
  new JoinRequestAlreadyPendingError("user_sam already asked org_acme"),
  new JoinRequestThrottledError(90),
  new JoinAutoDomainUnprovenError(
    "acme.com is held by 1 verified member(s) of org_acme",
  ),
  new JoinAutoConnectionAdmitsError(
    "an active connection already admits acme.com for org_acme",
  ),
  new JoinAutoNotLicensedError(
    "org_acme cannot enable automatic joining without a genuine license",
  ),
];

/** What the client actually receives, from the real server serialisation. */
function asShownToAPerson(error: Error) {
  const shape = errorFormatter({
    shape: { message: error.message, data: { code: "BAD_REQUEST" } },
    error: { cause: error, message: error.message, code: "BAD_REQUEST" },
  });
  return resolveErrorCopy({
    error: shape,
    fallbackTitle: "Couldn't do that",
  });
}

describe("given any refusal on the way into an organization", () => {
  describe("when it is shown to a person", () => {
    /** @scenario Every refusal reaches the person as words */
    it.each(
      REFUSALS.map((error) => [error.name, error] as const),
    )("shows %s as the copy registered for its code", (_name, error) => {
      const copy = asShownToAPerson(error);

      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      // The registry's own headline, not the caller's fallback: a code the
      // registry knows describes this exact failure, and the fallback only
      // names the action.
      expect(copy.title).not.toBe("Couldn't do that");
    });

    /** @scenario Every refusal reaches the person as words */
    it.each(
      REFUSALS.map((error) => [error.name, error] as const),
    )("never shows %s's code or its internal detail", (_name, error) => {
      const copy = asShownToAPerson(error);
      const shown = `${copy.title} ${copy.description} ${copy.tips.join(" ")}`;

      // The slug itself. This is the #5984 failure, and it is what
      // `error.message` would render, because the wire message IS the code.
      expect(shown).not.toContain("join_");
      // And nothing the server wrote for its own log line — organization
      // ids, counts of who verified what, the word "license" spelled the
      // internal way.
      expect(shown).not.toContain("org_acme");
      expect(shown).not.toContain("org_secret");
      expect(shown).not.toContain("jreq_1");
      expect(shown).not.toContain("user_sam");
    });

    /** @scenario Every refusal reaches the person as words */
    it("never lets one degrade to the generic unknown line", () => {
      for (const error of REFUSALS) {
        const copy = asShownToAPerson(error);
        expect(copy.title).not.toMatch(/something went wrong/i);
        expect(copy.description).not.toMatch(/unknown error/i);
      }
    });

    /** @scenario Every refusal reaches the person as words */
    it("still offers the error id, so support has something to quote", () => {
      // Not a refusal-specific rule, but the one thing that has to survive
      // every "tidy up the copy" pass on this surface.
      for (const error of REFUSALS) {
        const copy = asShownToAPerson(error);
        expect(copy).toHaveProperty("traceId");
      }
    });
  });
});

describe("given a refusal that says how long is left", () => {
  describe("when the throttle is shown", () => {
    /** @scenario Every refusal reaches the person as words */
    it("reads the wait off the refusal rather than guessing", () => {
      const copy = asShownToAPerson(new JoinRequestThrottledError(120));

      expect(copy.description).toContain("2 minutes");
    });
  });
});
