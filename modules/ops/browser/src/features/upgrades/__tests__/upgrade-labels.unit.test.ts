/** How the Upgrades pages word the reader's answers. Spec: modules/ops/specs/upgrades.feature */
import { describe, expect, it } from "vitest";

import {
  UPGRADE_COMMAND,
  groupStepsByRelease,
  orderReleasesNewestFirst,
  remainingCount,
  runOutcomeLabel,
  statusTone,
  summariseError,
  upgradeCommandFor,
} from "../model/upgrade-labels.ts";

describe("upgradeCommandFor()", () => {
  describe("when the reader says the image is newer than the installed release", () => {
    /** @scenario "An image newer than the ledger is described as behind with the command to run" */
    it("names the release upgrade command", () => {
      expect(upgradeCommandFor({ reason: "image-newer" })).toBe("pnpm task upgrade");
      expect(UPGRADE_COMMAND).toBe("pnpm task upgrade");
    });
  });

  describe("when the installation is current", () => {
    it("names no command", () => {
      expect(upgradeCommandFor({ reason: "current" })).toBeNull();
    });
  });
});

describe("statusTone() and runOutcomeLabel()", () => {
  describe("when a status or outcome is a string this release does not know", () => {
    /** @scenario "A step status the page does not know is shown as the reader gave it" */
    it("keeps the string unchanged in a neutral tone", () => {
      expect(statusTone("archived-by-a-newer-runner")).toBe("neutral");
      expect(runOutcomeLabel("quarantined")).toEqual({ label: "quarantined", tone: "neutral" });
    });
  });

  describe("when a run has no outcome yet", () => {
    it("reads as running", () => {
      expect(runOutcomeLabel(null)).toEqual({ label: "Running", tone: "info" });
    });
  });
});

describe("orderReleasesNewestFirst()", () => {
  describe("when the reader lists releases oldest first with the unreleased steps last", () => {
    /** @scenario "The releases list puts unreleased first, then the newest release, and calls out what is left" */
    it("puts unreleased first, then the newest release", () => {
      const ordered = orderReleasesNewestFirst([
        { release: "3.19.0" },
        { release: "3.19.4" },
        { release: "3.20.1" },
        { release: "3.9.10" },
        { release: null },
      ]);

      expect(ordered.map((entry) => entry.release)).toEqual([
        null,
        "3.20.1",
        "3.19.4",
        "3.19.0",
        "3.9.10",
      ]);
    });
  });
});

describe("remainingCount()", () => {
  it("counts every status but done and not-needed", () => {
    expect(remainingCount({ done: 473, "not-needed": 34, pending: 3, failed: 1 })).toBe(4);
  });
});

describe("summariseError()", () => {
  describe("when an error is long and carries parenthesised detail", () => {
    /** @scenario "A long step error reads as a one-line summary with the full text a click away" */
    it("keeps its first clause without the detail, capitalised and cut to one line", () => {
      const summary = summariseError(
        "reopened: image 3.20.1 (host:port:worker) served after upgrade run local_upgraderun_01JABCDEFGHJKMNPQRSTVWXYZ0 recorded the step done; the roster still lists it",
      );

      expect(summary.startsWith("Reopened: image 3.20.1 served after upgrade run")).toBe(true);
      expect(summary).not.toContain("host:port");
      expect(summary).not.toContain("roster");
      expect(summary.length).toBeLessThanOrEqual(90);
      expect(summary.endsWith("…")).toBe(true);
    });
  });

  it("leaves a short error whole", () => {
    expect(summariseError("Owner column missing")).toBe("Owner column missing");
  });
});

describe("groupStepsByRelease()", () => {
  describe("when steps span two releases and one has none", () => {
    it("keeps the reader's release order and puts the unreleased steps last", () => {
      const groups = groupStepsByRelease([
        { id: "x", release: null },
        { id: "a", release: "3.22.0" },
        { id: "b", release: "3.23.0" },
        { id: "c", release: "3.22.0" },
      ]);

      expect(groups.map((group) => [group.release, group.steps.map((s) => s.id)])).toEqual([
        ["3.22.0", ["a", "c"]],
        ["3.23.0", ["b"]],
        [null, ["x"]],
      ]);
    });
  });
});
