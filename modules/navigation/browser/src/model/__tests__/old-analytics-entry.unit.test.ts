/**
 * @vitest-environment node
 * @see modules/navigation/specs/product-sidebars.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  OLD_ANALYTICS_ORGANIZATION_MIN_AGE_DAYS,
  organizationKnewOldAnalytics,
} from "../old-analytics-entry.ts";

const NOW = Temporal.Instant.from("2026-11-24T12:00:00.000Z");
const THRESHOLD_MS = OLD_ANALYTICS_ORGANIZATION_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

const createdAgo = (ms: number): string =>
  Temporal.Instant.fromEpochMilliseconds(NOW.epochMilliseconds - ms).toString();

describe("organizationKnewOldAnalytics", () => {
  /** @scenario "An organization created exactly 21 days ago keeps the Analytics entry" */
  it("answers true for an organization exactly 21 days old", () => {
    expect(organizationKnewOldAnalytics({ createdAt: createdAgo(THRESHOLD_MS), now: NOW })).toBe(
      true,
    );
  });

  /** @scenario "An organization one millisecond short of 21 days has no Analytics entry" */
  it("answers false one millisecond before the organization turns 21 days old", () => {
    expect(
      organizationKnewOldAnalytics({ createdAt: createdAgo(THRESHOLD_MS - 1), now: NOW }),
    ).toBe(false);
  });

  /** @scenario "An organization whose creation date has not arrived keeps the Analytics entry" */
  it("answers true when the creation date is absent or unreadable", () => {
    expect(organizationKnewOldAnalytics({ createdAt: undefined, now: NOW })).toBe(true);
    expect(organizationKnewOldAnalytics({ createdAt: null, now: NOW })).toBe(true);
    expect(organizationKnewOldAnalytics({ createdAt: "not a date", now: NOW })).toBe(true);
  });
});
