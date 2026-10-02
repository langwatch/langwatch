import {
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
import type { HandledErrorShape } from "@langwatch/handled-error/read-handled-error";
import { describe, expect, it } from "vitest";

import {
  JoinAutoConnectionAdmitsError,
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  JoinNotAvailableError,
  JoinPolicyNotLicensedError,
  JoinRequestAlreadyPendingError,
  JoinRequestNotFoundError,
  JoinRequestNotPendingError,
  JoinRequestThrottledError,
} from "../identity.errors.ts";

/** Every refusal on the way into an organization, built the way the services
 *  build them, internal detail included. Listed so a new refusal without copy fails. */
const REFUSALS = [
  new JoinNotAvailableError("organization org_secret is not open to acme.com"),
  new JoinRequestNotFoundError("jreq_1 does not belong to org_acme"),
  new JoinRequestNotPendingError("jreq_1 is APPROVED"),
  new JoinRequestAlreadyPendingError("user_sam already asked org_acme"),
  new JoinRequestThrottledError(90),
  new JoinAutoDomainUnprovenError("acme.com is held by 1 verified member(s) of org_acme"),
  new JoinAutoConnectionAdmitsError("an active connection already admits acme.com for org_acme"),
  new JoinAutoNotLicensedError("org_acme cannot enable automatic joining without a license"),
  new JoinPolicyNotLicensedError("org_acme cannot set a join policy without a license"),
];

const shapeOf = (error: (typeof REFUSALS)[number]): HandledErrorShape => ({
  code: error.code,
  meta: error.meta,
  httpStatus: error.httpStatus,
  fault: error.fault,
  retryable: error.retryable,
  tips: error.tips,
  docsUrl: error.docsUrl,
  traceId: error.traceId,
  reasons: [],
});

describe("given any refusal on the way into an organization", () => {
  describe("when it is shown to a person", () => {
    /** @scenario "Every refusal reaches the person as words" */
    it.each(REFUSALS.map((error) => [error.code, error] as const))(
      "shows %s as registered words, never its code, its detail or the unknown line",
      (code, error) => {
        const copy = explainHandledError(shapeOf(error));
        const shown = `${copy.title} ${copy.description}`;

        expect(copy.isRegistered).toBe(true);
        expect(copy.title).not.toBe(UNKNOWN_ERROR_PRESENTATION.title);
        expect(copy.description.length).toBeGreaterThan(0);
        expect(shown).not.toContain(code);
        expect(shown).not.toContain("org_acme");
        expect(shown).not.toContain("org_secret");
        expect(shown).not.toContain("jreq_1");
        expect(shown).not.toContain("user_sam");
      },
    );
  });
});
