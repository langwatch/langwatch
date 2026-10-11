/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import { imageVersionName, imageVersionOf } from "../image-version.ts";
import { computeInstallationState, type InstallationFacts } from "../installation-state.ts";
import type { LedgerRunRow } from "../reader.repository.ts";
import { pickInstalled } from "../reader.service.ts";
import { UNRELEASED_IMAGE } from "../step-view.ts";

const developmentUpgrade: LedgerRunRow = {
  id: "run_up",
  kind: "upgrade",
  release: null,
  started_at: "2026-10-05T10:00:00Z",
  finished_at: "2026-10-05T10:01:00Z",
  outcome: "succeeded",
  plan: null,
  report: null,
};

const settled: InstallationFacts = {
  imageRelease: "3.21.0",
  imageSteps: [],
  installed: "3.21.0",
  ledgerHoldsRecords: true,
  steps: [],
  failedTargets: 0,
  holdsLease: false,
  lastRunFailed: false,
};

describe("pickInstalled", () => {
  describe("when the newest succeeded run is an upgrade by a development build", () => {
    /** @scenario "An upgrade by a development build reads as installed past every release" */
    it("reads past every release, not a settled step's older release", () => {
      const picked = pickInstalled({
        succeededRun: developmentUpgrade,
        stepFacts: [
          {
            id: "prisma:1",
            kind: "postgres-schema",
            mode: "blocking",
            status: "done",
            release: "3.19.0",
            inferred: true,
          },
        ],
      });
      expect(picked.origin).toBe("recorded");
      const verdict = computeInstallationState({
        ...settled,
        imageRelease: UNRELEASED_IMAGE,
        installed: picked.installed,
      });
      expect(verdict.state).toBe("up-to-date");
      expect(verdict.summary).not.toContain("unreleased");
    });
  });
});

describe("computeInstallationState summaries", () => {
  describe("when a development build is up to date", () => {
    /** @scenario "An up-to-date development build names itself in the summary" */
    it("names the build, never unreleased", () => {
      const name = imageVersionName(
        imageVersionOf({ release: null, containsRelease: "3.20.1", commit: "abc1234" }),
      );
      const verdict = computeInstallationState({
        ...settled,
        imageRelease: UNRELEASED_IMAGE,
        imageName: name,
        installed: UNRELEASED_IMAGE,
      });
      expect(verdict.summary).toBe("Development build 3.20.1+abc1234 is current.");
    });
  });

  describe("when a release is up to date", () => {
    /** @scenario "An up-to-date release names its release in the summary" */
    it("names the release", () => {
      expect(computeInstallationState(settled).summary).toBe("3.21.0 is current.");
    });
  });

  describe("when the image is newer than the installed release", () => {
    /** @scenario "A state summary names no command to run" */
    it("names both releases and no command", () => {
      const { summary } = computeInstallationState({ ...settled, imageRelease: "3.22.0" });
      expect(summary).toBe("Image 3.22.0 is newer than the installed 3.21.0.");
    });
  });
});

describe("imageVersionName", () => {
  it("reads a release as itself and a build with nothing known as a development build", () => {
    expect(imageVersionName({ kind: "release", release: "3.21.0" })).toBe("3.21.0");
    expect(imageVersionName({ kind: "development", containsRelease: "3.20.1", commit: null })).toBe(
      "Development build 3.20.1",
    );
  });
});
