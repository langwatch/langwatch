// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The words a cutover uses and the two levers it offers: what is serving
 * sign-in now, where an inherited domain's trust came from, and when either
 * lever may be pressed.
 */
import { describe, expect, it } from "vitest";

import {
  inheritedDomainLine,
  migrationLevers,
  migrationTitle,
  previousProviderName,
  servingSignInNow,
  type MigrationView,
} from "../migration-route.ts";

function migrationOf(overrides: Partial<MigrationView> = {}): MigrationView {
  return {
    legacy: { connectionId: "connection-legacy", providerId: "auth0" },
    replacement: { connectionId: "connection-new", providerId: "okta-primary" },
    phase: "GRACE_LEGACY",
    selectedRoute: "legacy",
    inheritedDomains: [],
    testSignIn: { done: false },
    members: { activeCount: 10, linkedCount: 4, stragglers: [], nextCursor: null },
    scim: { status: "not-applicable" },
    blockers: [],
    canFinalize: false,
    ...overrides,
  };
}

describe("an inherited domain's line", () => {
  it.each([
    ["operator-attested", "operator attestation"],
    ["dns-txt", "published domain proof"],
    ["https-file", "published domain proof"],
    ["license-token", "installation licence"],
  ])("names where %s trust came from", (method, proof) => {
    expect(inheritedDomainLine({ domain: "acme.test", method })).toBe(`acme.test (${proof})`);
  });

  it("falls back to the configuration it was inherited from", () => {
    expect(inheritedDomainLine({ domain: "acme.test", method: "legacy" })).toBe(
      "acme.test (existing legacy configuration)",
    );
  });
});

describe("what a migration is called", () => {
  it("spells the vendor when it knows it", () => {
    expect(migrationTitle("auth0")).toBe("Auth0 migration");
    expect(previousProviderName("auth0")).toBe("Auth0");
  });

  it("never shows an identifier it cannot spell", () => {
    expect(migrationTitle("acme-internal")).toBe("Single sign-on migration");
    expect(previousProviderName("acme-internal")).toBe("the previous provider");
  });
});

describe("who is serving sign-in now", () => {
  it("is the previous provider in the present tense while the route is legacy", () => {
    expect(servingSignInNow(migrationOf())).toBe("Auth0");
    expect(servingSignInNow(migrationOf({ legacy: { connectionId: "c", providerId: "x" } }))).toBe(
      "Your existing provider",
    );
  });

  it("is the replacement once the route points at it", () => {
    expect(servingSignInNow(migrationOf({ selectedRoute: "direct" }))).toBe("okta-primary");
  });
});

describe("the levers a cutover offers", () => {
  it("offers the switch, refused until somebody has signed in through the replacement", () => {
    const blocked = migrationLevers({ migration: migrationOf(), connectionActive: true });
    expect(blocked.route).toEqual({ to: "direct", label: "Switch to new SSO", disabled: true });

    const ready = migrationLevers({
      migration: migrationOf({ testSignIn: { done: true } }),
      connectionActive: true,
    });
    expect(ready.route).toEqual({ to: "direct", label: "Switch to new SSO", disabled: false });
  });

  it("refuses the switch while the replacement is not on", () => {
    const levers = migrationLevers({
      migration: migrationOf({ testSignIn: { done: true } }),
      connectionActive: false,
    });

    expect(levers.route?.disabled).toBe(true);
  });

  it("offers the way back once the route points at the replacement", () => {
    const levers = migrationLevers({
      migration: migrationOf({ selectedRoute: "direct" }),
      connectionActive: true,
    });

    expect(levers.route).toEqual({ to: "legacy", label: "Roll back to Auth0", disabled: false });
  });

  it("takes the route away once finalization has started", () => {
    for (const phase of ["FINALIZING", "FINALIZED"] as const) {
      expect(
        migrationLevers({ migration: migrationOf({ phase }), connectionActive: true }).route,
      ).toBeNull();
    }
  });

  it("names finalization a retry once it has been tried", () => {
    expect(
      migrationLevers({ migration: migrationOf({ phase: "FINALIZING" }), connectionActive: true })
        .finalize.label,
    ).toBe("Retry finalization");
  });

  it("holds finalization until its own checks pass", () => {
    expect(
      migrationLevers({ migration: migrationOf(), connectionActive: true }).finalize.disabled,
    ).toBe(true);
    expect(
      migrationLevers({ migration: migrationOf({ canFinalize: true }), connectionActive: true })
        .finalize.disabled,
    ).toBe(false);
  });

  it("presses nothing twice while a press is still settling", () => {
    const levers = migrationLevers({
      migration: migrationOf({ testSignIn: { done: true }, canFinalize: true }),
      connectionActive: true,
      pending: true,
    });

    expect(levers.route?.disabled).toBe(true);
    expect(levers.finalize.disabled).toBe(true);
  });
});
