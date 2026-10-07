/**
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import { formatStatus } from "../format-status.ts";
import type { UpgradeStatus } from "../reader.schema.ts";

function status(overrides: Partial<UpgradeStatus> = {}): UpgradeStatus {
  return {
    state: "up-to-date",
    label: "Up to date",
    tone: "neutral",
    reason: "current",
    summary: "Release 3.21.0 is current.",
    installed: "3.21.0",
    origin: "recorded",
    image: "3.21.0",
    floor: "3.20.1",
    ledgerFloor: null,
    lease: null,
    lastRun: null,
    counts: { done: 4 },
    failedStepIds: [],
    failedTargets: 0,
    ...overrides,
  };
}

describe("formatStatus", () => {
  /** @scenario "The status prints as plain text for the command line" */
  it("names the state, the releases, the failed step and the lease holder", () => {
    const text = formatStatus({
      status: status({
        state: "needs-attention",
        label: "Needs attention",
        tone: "danger",
        reason: "failed-step",
        summary: "1 step failed.",
        counts: { done: 3, failed: 1 },
        failedStepIds: ["prisma:20261006130000_add_column"],
        lease: {
          name: "upgrade",
          owner: "runner-1",
          image: "3.21.0",
          host: "pre-roll-abc",
          heartbeatAt: "2026-10-06T12:00:00Z",
          expiresAt: "2026-10-06T12:05:00Z",
        },
        lastRun: {
          id: "upgraderun_1",
          kind: "upgrade",
          release: "3.21.0",
          floor: null,
          startedAt: "2026-10-06T11:59:00Z",
          finishedAt: null,
          outcome: null,
        },
      }),
    });
    expect(text).toContain("Installation: Needs attention (danger)");
    expect(text).toContain("Installed:    3.21.0");
    expect(text).toContain("Image:        3.21.0");
    expect(text).toContain("Failed steps: prisma:20261006130000_add_column");
    expect(text).toContain("held by runner-1 on pre-roll-abc");
    expect(text).toContain("upgraderun_1 (upgrade) unfinished");
  });

  /** @scenario "An empty ledger prints as no upgrade recorded yet" */
  it("prints an empty ledger as no upgrade recorded yet", () => {
    const text = formatStatus({
      status: status({
        state: "never-upgraded",
        label: "Never upgraded",
        tone: "warning",
        reason: "no-upgrade-recorded",
        summary: "No upgrade recorded yet. Run the upgrade before this image serves.",
        installed: null,
        origin: "none",
        counts: {},
      }),
    });
    expect(text).toContain("No upgrade recorded yet");
    expect(text).toContain("no release recorded");
  });

  /** @scenario "A step status the reader does not know prints raw in the text" */
  it("prints an unknown step status exactly as stored", () => {
    const text = formatStatus({ status: status({ counts: { done: 2, quarantined: 1 } }) });
    expect(text).toContain("quarantined 1");
  });
});
