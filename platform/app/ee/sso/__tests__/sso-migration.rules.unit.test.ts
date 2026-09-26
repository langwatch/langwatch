// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  arrivalMatchOf,
  MIGRATION_QUIET_FLOOR_MS,
  MIGRATION_QUIET_PERIOD_MS,
  quietPeriodOf,
  scimStatusOf,
  strandedUserIdsOf,
} from "../sso-migration.rules";

describe("scimStatusOf", () => {
  describe("given the previous connection's directory sync is pushing today", () => {
    /** @scenario "Finishing moves the previous connection's directory sync across" */
    it("says the sync moves across with the finish rather than asking anyone to repoint it", () => {
      expect(
        scimStatusOf({ legacySyncs: true, replacementSyncState: null }),
      ).toBe("moves-with-finish");
    });

    it("is ready once the replacement has a token, whether or not a push has landed yet", () => {
      expect(
        scimStatusOf({
          legacySyncs: true,
          replacementSyncState: "TOKEN_ISSUED",
        }),
      ).toBe("ready");
      expect(
        scimStatusOf({ legacySyncs: true, replacementSyncState: "SYNCING" }),
      ).toBe("ready");
    });
  });

  describe("given no directory sync pushes through the previous connection", () => {
    it("has nothing to move", () => {
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: null }),
      ).toBe("not-applicable");
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: "REVOKED" }),
      ).toBe("not-applicable");
    });

    it("is ready when the customer set the replacement's sync up themselves", () => {
      expect(
        scimStatusOf({ legacySyncs: false, replacementSyncState: "SYNCING" }),
      ).toBe("ready");
    });
  });
});

describe("quietPeriodOf", () => {
  const switchedOverAtMs = Date.parse("2026-09-01T09:00:00.000Z");
  const hour = 60 * 60 * 1000;

  describe("given nobody signs in through the previous provider after the switch-over", () => {
    /** @scenario "The quiet period counts from the switch-over and the last sign-in through the previous provider" */
    it("opens finishing two days after the switch-over", () => {
      const clearsAtMs = switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS;
      expect(
        quietPeriodOf({
          switchedOverAtMs,
          lastLegacyAuthenticationAtMs: null,
          nowMs: clearsAtMs - 1,
        }),
      ).toEqual({ clearsAtMs, complete: false });
      expect(
        quietPeriodOf({
          switchedOverAtMs,
          lastLegacyAuthenticationAtMs: null,
          nowMs: clearsAtMs,
        }),
      ).toEqual({ clearsAtMs, complete: true });
    });

    it("does not count sign-ins through the previous provider before the switch-over", () => {
      expect(
        quietPeriodOf({
          switchedOverAtMs,
          lastLegacyAuthenticationAtMs: switchedOverAtMs - hour,
          nowMs: switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS,
        }),
      ).toEqual({
        clearsAtMs: switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS,
        complete: true,
      });
    });
  });

  describe("given somebody signs in through the previous provider after the switch-over", () => {
    it("moves finishing to seven days after that sign-in", () => {
      const straggler = switchedOverAtMs + hour;
      expect(
        quietPeriodOf({
          switchedOverAtMs,
          lastLegacyAuthenticationAtMs: straggler,
          nowMs: switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS,
        }),
      ).toEqual({
        clearsAtMs: straggler + MIGRATION_QUIET_PERIOD_MS,
        complete: false,
      });
    });
  });

  describe("given sign-in has not been switched over", () => {
    it("has no time to show and is not complete", () => {
      expect(
        quietPeriodOf({
          switchedOverAtMs: null,
          lastLegacyAuthenticationAtMs: null,
          nowMs: switchedOverAtMs,
        }),
      ).toEqual({ clearsAtMs: null, complete: false });
    });
  });
});

describe("arrivalMatchOf", () => {
  const provesAcme = (domain: string) => domain === "acme.test";
  const arrival = (overrides: Partial<Parameters<typeof arrivalMatchOf>[0]>) =>
    arrivalMatchOf({
      email: "kim@Acme.test",
      accountsHoldingAddress: 1,
      provesDomain: provesAcme,
      ...overrides,
    });

  /** @scenario "The new connection recognises members by address on a domain it proved, confirmed or not" */
  it("matches an address one account holds on a proved domain, and names why it matches no other", () => {
    expect(arrival({})).toBe("matched");
    expect(arrival({ email: null })).toBe("no-address");
    expect(arrival({ accountsHoldingAddress: 2 })).toBe("shared-address");
    expect(arrival({ email: "kim@elsewhere.test" })).toBe("unproved-domain");
  });
});

describe("strandedUserIdsOf", () => {
  const legacyIdentifierIds = new Set([
    "kim-legacy",
    "lee-legacy",
    "max-legacy",
  ]);
  const identifier = (
    id: string,
    userId: string,
    overrides: { state?: string; provider?: string } = {},
  ) => ({ id, userId, state: "VERIFIED", provider: "oidc", ...overrides });

  /** @scenario "Finishing leaves a member whose only way in is the previous provider on it rather than stopping" */
  it("names the people whose only verified way in is the previous provider", () => {
    expect(
      strandedUserIdsOf({
        legacyIdentifierIds,
        identifiers: [
          identifier("kim-legacy", "kim", { state: "PRIMARY" }),
          identifier("kim-passkey", "kim", { provider: "passkey" }),
          identifier("lee-legacy", "lee"),
          identifier("lee-address", "lee", { provider: "email" }),
          identifier("max-legacy", "max", { state: "ATTACHED" }),
        ],
      }),
    ).toEqual(new Set(["kim"]));
  });
});
