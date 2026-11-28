// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The configured half of the source badge: what each stored status draws.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { describe, expect, it } from "vitest";

import { sourceBadge } from "../model/source-health-display.ts";

describe("sourceBadge", () => {
  it.each([
    ["active", "Active"],
    ["awaiting_first_event", "Awaiting first event"],
    ["disabled", "Disabled"],
    // A word no release knows is off, and so are the names an object literal
    // inherits: neither may come back as anything but a drawable badge.
    ["paused", "Disabled"],
    ["toString", "Disabled"],
    ["constructor", "Disabled"],
  ])("draws status %s as %s", (status, label) => {
    const badge = sourceBadge({ status, errorCount: 0 });

    expect(badge.label).toBe(label);
    expect(badge.icon).toBeDefined();
  });
});
