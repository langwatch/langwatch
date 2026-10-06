/** How the Upgrades pages word the reader's answers. Spec: modules/ops/specs/upgrades.feature */
import { describe, expect, it } from "vitest";

import {
  UPGRADE_COMMAND,
  groupStepsByMode,
  groupStepsByRelease,
  runOutcomeLabel,
  statusTone,
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

describe("groupStepsByMode()", () => {
  describe("when a release has steps of every mode and one unknown", () => {
    it("orders blocking, background, operator, then the unknown mode", () => {
      const groups = groupStepsByMode([
        { id: "a", mode: "operator" },
        { id: "b", mode: "later" },
        { id: "c", mode: "background" },
        { id: "d", mode: "blocking" },
      ]);

      expect(groups.map((group) => group.label)).toEqual([
        "Blocking",
        "Background",
        "Operator",
        "later",
      ]);
    });
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
