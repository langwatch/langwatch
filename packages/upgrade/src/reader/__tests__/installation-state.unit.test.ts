/**
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import { type InstallationFacts, computeInstallationState } from "../installation-state.ts";

function facts(overrides: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    imageRelease: "3.21.0",
    imageSteps: [],
    floor: "3.20.1",
    installed: "3.21.0",
    ledgerFloor: null,
    ledgerHoldsRecords: true,
    steps: [{ id: "prisma:1", status: "done" }],
    failedTargets: 0,
    holdsLease: false,
    ...overrides,
  };
}

describe("computeInstallationState", () => {
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

  /** @scenario "An image older than the ledger and at or above the floor reads as rolled back" */
  it("reads an older image at or above the floor as rolled back", () => {
    const verdict = computeInstallationState(facts({ installed: "3.22.0" }));
    expect(verdict).toMatchObject({ state: "rolled-back", reason: "image-older" });
  });

  /** @scenario "An installed release below the floor reads as unsupported" */
  it("reads an installed release below the floor as unsupported", () => {
    const verdict = computeInstallationState(facts({ installed: "3.16.0" }));
    expect(verdict).toMatchObject({ state: "unsupported", reason: "installed-below-floor" });
  });

  /** @scenario "An image below the floor the ledger recorded reads as unsupported" */
  it("reads an image below the ledger's floor as unsupported", () => {
    const verdict = computeInstallationState(
      facts({ imageRelease: "3.19.0", installed: "3.21.0", ledgerFloor: "3.20.1" }),
    );
    expect(verdict).toMatchObject({ state: "unsupported", reason: "image-below-ledger-floor" });
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

  /** @scenario "Unsupported wins over every other state" */
  it("lets unsupported win over needs attention and upgrading", () => {
    const verdict = computeInstallationState(
      facts({
        installed: "3.16.0",
        steps: [{ id: "prisma:1", status: "failed" }],
        holdsLease: true,
      }),
    );
    expect(verdict.state).toBe("unsupported");
  });

  it("does not order an unversioned cloud build against the floor or the ledger", () => {
    const verdict = computeInstallationState(
      facts({ imageRelease: "git-1a2b3c4", installed: "git-9f8e7d6", floor: "3.20.1" }),
    );
    expect(verdict.state).toBe("up-to-date");
  });

  it("reads an empty ledger as behind with no upgrade recorded", () => {
    const verdict = computeInstallationState(
      facts({ installed: null, ledgerHoldsRecords: false, steps: [] }),
    );
    expect(verdict).toMatchObject({ state: "behind", reason: "no-upgrade-recorded" });
    expect(verdict.summary).toContain("No upgrade recorded yet");
  });
});
