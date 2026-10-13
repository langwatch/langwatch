import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { signalsRaisedBy, type SignalInput } from "../self-hosted-signals.rules.ts";

const NOW = Temporal.Instant.from("2026-09-22T12:00:00Z");
const daysAgo = (days: number) => NOW.subtract({ hours: 24 * days });
const daysAhead = (days: number) => NOW.add({ hours: 24 * days });

function input(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    properties: {},
    firstSeenAt: undefined,
    alreadyRaised: [],
    license: undefined,
    domainHasCloudAccount: false,
    now: NOW,
    ...overrides,
  };
}

describe("signalsRaisedBy()", () => {
  /** @scenario "An install that grew past a team is raised" */
  it("raises seats_crossed_threshold at 25 users and not at 24", () => {
    expect(signalsRaisedBy(input({ properties: { users: 25 } }))).toContain(
      "seats_crossed_threshold",
    );
    expect(signalsRaisedBy(input({ properties: { users: 24 } }))).toEqual([]);
  });

  /** @scenario "Ingestion is only raised once the install has been running a month" */
  it("raises sustained_ingestion only for an install first seen 28 days ago", () => {
    const properties = { traces_28d: 10_000 };
    expect(signalsRaisedBy(input({ properties, firstSeenAt: daysAgo(10) }))).toEqual([]);
    expect(signalsRaisedBy(input({ properties }))).toEqual([]);
    expect(signalsRaisedBy(input({ properties, firstSeenAt: daysAgo(28) }))).toEqual([
      "sustained_ingestion",
    ]);
  });

  /** @scenario "A licensed feature running without a license is raised" */
  it("raises licensed_feature_without_license for single sign-on with no bound license", () => {
    const properties = { sso_provider: "okta" };
    expect(signalsRaisedBy(input({ properties }))).toEqual(["licensed_feature_without_license"]);
    expect(
      signalsRaisedBy(
        input({ properties, license: { expiresAt: daysAhead(300), lastSyncAt: undefined } }),
      ),
    ).toEqual([]);
  });

  /** @scenario "A license about to lapse is raised" */
  it("raises license_expiring within 45 days of the term's end, never after it", () => {
    const lapsing = (days: number) =>
      signalsRaisedBy(input({ license: { expiresAt: daysAhead(days), lastSyncAt: undefined } }));
    expect(lapsing(30)).toEqual(["license_expiring"]);
    expect(lapsing(60)).toEqual([]);
    expect(lapsing(-1)).toEqual([]);
  });

  /** @scenario "A company that already has an account with us is raised" */
  it("raises domain_has_cloud_account when the caller found one", () => {
    expect(signalsRaisedBy(input({ domainHasCloudAccount: true }))).toEqual([
      "domain_has_cloud_account",
    ]);
  });

  /** @scenario "A licensed install that stopped syncing is raised" */
  it("raises license_sync_stale after a week without a sync, and never for one that never synced", () => {
    const synced = (lastSyncAt: Instant | undefined) =>
      signalsRaisedBy(input({ license: { expiresAt: daysAhead(300), lastSyncAt } }));
    expect(synced(daysAgo(8))).toEqual(["license_sync_stale"]);
    expect(synced(daysAgo(2))).toEqual([]);
    expect(synced(undefined)).toEqual([]);
  });

  /** @scenario "A signal already raised is never raised again" */
  it("does not raise a signal already on the install's list", () => {
    expect(
      signalsRaisedBy(
        input({ properties: { users: 40 }, alreadyRaised: ["seats_crossed_threshold"] }),
      ),
    ).toEqual([]);
  });
});
