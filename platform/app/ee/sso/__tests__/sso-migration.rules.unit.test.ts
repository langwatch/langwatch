// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  MIGRATION_QUIET_FLOOR_MS,
  MIGRATION_QUIET_PERIOD_MS,
  memberMoveOf,
  migrationBlockers,
  quietPeriodOf,
  scimStatusOf,
} from "../sso-migration.rules";
import { arrivalMatchOf } from "../sso-migration-arrival";

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

/** @scenario "The quiet period counts from the switch-over and the last sign-in through the previous provider" */
describe("quietPeriodOf", () => {
  const switchedOverAtMs = Date.parse("2026-09-01T09:00:00.000Z");
  const hour = 60 * 60 * 1000;

  describe("given nobody signs in through the previous provider after the switch-over", () => {
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
      vouchedFor: true,
      accountsHoldingAddress: 1,
      provesDomain: provesAcme,
      ...overrides,
    });

  /** @scenario "Members the new connection can match do not have to sign in before the update finishes" */
  it("matches a vouched-for address held by one account on a proved domain", () => {
    expect(arrival({})).toBe("matched");
  });

  /** @scenario "A member the new connection cannot match holds the update until it can" */
  it("names the reason a person cannot be matched", () => {
    expect(arrival({ vouchedFor: false })).toBe("unverified-address");
    expect(arrival({ email: null })).toBe("unverified-address");
    expect(arrival({ accountsHoldingAddress: 2 })).toBe("shared-address");
    expect(arrival({ email: "kim@elsewhere.test" })).toBe("unproved-domain");
  });
});

describe("memberMoveOf", () => {
  /** @scenario "Members the new connection can match do not have to sign in before the update finishes" */
  it("moves a matched person at their next sign-in when they keep another way in", () => {
    expect(
      memberMoveOf({ arrival: "matched", previousIsOnlyWayIn: false }),
    ).toBe("next-sign-in");
  });

  /** @scenario "A member whose only way in is the previous provider signs in once before the update finishes" */
  it("asks a matched person to sign in once when the previous provider is their only way in", () => {
    expect(
      memberMoveOf({ arrival: "matched", previousIsOnlyWayIn: true }),
    ).toBe("sign-in-once");
  });

  /** @scenario "A member the new connection cannot match holds the update until it can" */
  it("keeps the reason for a person the replacement cannot match", () => {
    expect(
      memberMoveOf({ arrival: "unproved-domain", previousIsOnlyWayIn: true }),
    ).toBe("unproved-domain");
  });
});

describe("migrationBlockers", () => {
  const ready = {
    selectedRoute: "direct" as const,
    testSignInDone: true,
    liveRecoveryCount: 1,
    waitingCount: 0,
    deactivatedOnPreviousCount: 0,
    quietComplete: true,
    sharedLegacyIdentifiers: false,
  };

  /** @scenario "Members the new connection can match do not have to sign in before the update finishes" */
  it("does not wait for members the replacement will match at their next sign-in", () => {
    expect(migrationBlockers(ready)).toEqual([]);
  });

  /** @scenario "A member the new connection cannot match holds the update until it can" */
  it("waits for members who cannot be moved across, and for deactivated members left on the previous provider", () => {
    expect(
      migrationBlockers({
        ...ready,
        waitingCount: 2,
        deactivatedOnPreviousCount: 1,
      }).map(({ code }) => code),
    ).toEqual([
      "members-cannot-move-across",
      "deactivated-members-on-previous-provider",
    ]);
  });
});
