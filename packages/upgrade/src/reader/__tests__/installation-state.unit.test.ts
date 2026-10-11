/**
 * @see specs/upgrade/upgrade-reader.feature
 * @see specs/upgrade/upgrade-stuck-states-gate.feature
 */
import { describe, expect, it } from "vitest";

import { type InstallationFacts, computeInstallationState } from "../installation-state.ts";

function facts(overrides: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    imageRelease: "3.21.0",
    imageSteps: [],
    installed: "3.21.0",
    ledgerHoldsRecords: true,
    steps: [{ id: "prisma:1", status: "done" }],
    failedTargets: 0,
    holdsLease: false,
    lastRunFailed: false,
    ...overrides,
  };
}

describe("computeInstallationState", () => {
  /** @scenario "A failed last run with every step settled reads as needs attention" */
  it("reads a failed last run as needs attention when every step is done", () => {
    expect(computeInstallationState(facts({ lastRunFailed: true }))).toMatchObject({
      state: "needs-attention",
      reason: "failed-run",
    });
  });

  /** @scenario "An installation whose image and ledger agree is up to date" */
  it("reads an agreeing image and ledger as up to date", () => {
    expect(computeInstallationState(facts())).toMatchObject({
      state: "up-to-date",
      reason: "current",
    });
  });

  /** @scenario "Background steps still pending read as finishing in background" */
  it("reads pending background steps as finishing in background", () => {
    const verdict = computeInstallationState(
      facts({
        steps: [
          { id: "prisma:1", status: "done" },
          { id: "app:backfill", status: "pending" },
        ],
      }),
    );
    expect(verdict.state).toBe("finishing-in-background");
  });

  /** @scenario "A run holding the lease reads as upgrading" */
  it("reads a held lease as upgrading", () => {
    const verdict = computeInstallationState(facts({ installed: "3.20.1", holdsLease: true }));
    expect(verdict.state).toBe("upgrading");
  });

  /** @scenario "An image newer than the ledger reads as behind" */
  it("reads an image newer than the ledger as behind", () => {
    const verdict = computeInstallationState(facts({ installed: "3.20.1" }));
    expect(verdict).toMatchObject({ state: "behind", reason: "image-newer" });
  });

  /** @scenario "An image declaring a blocking step the ledger lacks reads as behind" */
  it("reads a blocking step the ledger has not completed as behind", () => {
    const verdict = computeInstallationState(
      facts({
        imageSteps: [
          { id: "prisma:1", mode: "blocking" },
          { id: "prisma:2", mode: "blocking" },
        ],
      }),
    );
    expect(verdict).toMatchObject({ state: "behind", reason: "blocking-steps-pending" });
  });

  it("does not read a pending background step the image declares as behind", () => {
    const verdict = computeInstallationState(
      facts({
        imageSteps: [{ id: "app:backfill", mode: "background" }],
        steps: [{ id: "app:backfill", status: "pending" }],
      }),
    );
    expect(verdict.state).toBe("finishing-in-background");
  });

  /** @scenario "An image older than the ledger reads as rolled back" */
  it("reads an older image as rolled back", () => {
    const verdict = computeInstallationState(facts({ installed: "3.22.0" }));
    expect(verdict).toMatchObject({ state: "rolled-back", reason: "image-older" });
  });

  /** @scenario "A failed step reads as needs attention before anything softer" */
  it("reads a failed step as needs attention before behind or finishing", () => {
    const verdict = computeInstallationState(
      facts({
        installed: "3.20.1",
        steps: [
          { id: "prisma:1", status: "failed" },
          { id: "app:backfill", status: "pending" },
        ],
      }),
    );
    expect(verdict).toMatchObject({ state: "needs-attention", reason: "failed-step" });
  });

  /** @scenario "A failed target reads as needs attention" */
  it("reads a failed target as needs attention", () => {
    const verdict = computeInstallationState(facts({ failedTargets: 1 }));
    expect(verdict).toMatchObject({ state: "needs-attention", reason: "failed-target" });
  });

  it("does not order an unversioned cloud build against the ledger", () => {
    const verdict = computeInstallationState(
      facts({ imageRelease: "git-1a2b3c4", installed: "git-9f8e7d6" }),
    );
    expect(verdict.state).toBe("up-to-date");
  });

  it("reads an empty ledger as behind with no upgrade recorded", () => {
    const verdict = computeInstallationState(
      facts({ installed: null, ledgerHoldsRecords: false, steps: [] }),
    );
    expect(verdict).toMatchObject({ state: "never-upgraded", reason: "no-upgrade-recorded" });
    expect(verdict.summary).toContain("No upgrade recorded yet");
  });
});
