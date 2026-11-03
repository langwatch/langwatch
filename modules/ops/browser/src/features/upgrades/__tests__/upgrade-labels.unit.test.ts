/** How the Upgrades pages word the reader's answers. Spec: modules/ops/specs/upgrades.feature */
import { describe, expect, it } from "vitest";

import {
  groupStepsByRelease,
  heldOrganizationCount,
  migratedSplit,
  orderReleasesNewestFirst,
  releaseGroupName,
  remainingCount,
  runKindLabel,
  runOutcomeLabel,
  statusTone,
  summariseError,
  versionLine,
} from "../model/upgrade-labels.ts";

describe("versionLine()", () => {
  describe("when the build is not a release", () => {
    /** @scenario "A development build reads as the release it contains and its short commit" */
    it("names the release it contains and its short commit, and a release reads Running", () => {
      expect(
        versionLine({ kind: "development", containsRelease: "3.20.1", commit: "abc1234def" }),
      ).toBe("Development build 3.20.1+abc1234");
      expect(versionLine({ kind: "development", containsRelease: null, commit: null })).toBe(
        "Development build",
      );
      expect(versionLine({ kind: "release", release: "3.21.0" })).toBe("Running 3.21.0");
    });
  });
});

describe("runKindLabel()", () => {
  it("reads the seed run as imported history and an unknown kind raw", () => {
    expect(runKindLabel("seed")).toBe("Imported history");
    expect(runKindLabel("upgrade")).toBe("Upgrade");
    expect(runKindLabel("rehearsal")).toBe("rehearsal");
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
  describe("when the reader lists releases oldest first with the development build last", () => {
    /** @scenario "The Steps tab groups by version, the development build first, then the newest release" */
    it("puts the development build first, then the newest release, the oldest as and earlier", () => {
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
      expect(releaseGroupName({ release: null, oldest: false })).toBe("Development build");
      expect(releaseGroupName({ release: "3.18.1", oldest: true })).toBe("3.18.1 and earlier");
      expect(releaseGroupName({ release: "3.20.1", oldest: false })).toBe("3.20.1");
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
    it("keeps the reader's release order and puts the development build last", () => {
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

describe("heldOrganizationCount()", () => {
  const held = (tenantId: string) => ({ tenantId, status: "migrated" });

  describe("when one organization is held by two steps and another is parked", () => {
    /** @scenario "Held organizations are counted once however many steps hold them" */
    it("counts each organization once", () => {
      expect(
        heldOrganizationCount([
          {
            tenant: "organization",
            migratedIsSteady: false,
            attention: [held("org-a"), { tenantId: "org-b", status: "parked" }],
          },
          { tenant: "organization", migratedIsSteady: false, attention: [held("org-a")] },
          { tenant: "organization", migratedIsSteady: false, attention: [] },
        ]),
      ).toBe(2);
    });
  });

  describe("when a user-rooted step holds users", () => {
    /** @scenario "Users a user-rooted step holds are not counted as held organizations" */
    it("counts only organization-rooted holds", () => {
      expect(
        heldOrganizationCount([
          { tenant: "organization", migratedIsSteady: false, attention: [held("org-a")] },
          {
            tenant: "user",
            migratedIsSteady: false,
            attention: [held("user-1"), held("user-2")],
          },
        ]),
      ).toBe(1);
    });
  });

  describe("when a step's migrated is its steady state", () => {
    /** @scenario "A step that never finalizes by design keeps its users in step, not held" */
    it("counts none of its migrated tenants as held, and still counts a parked one", () => {
      expect(
        heldOrganizationCount([
          {
            tenant: "organization",
            migratedIsSteady: true,
            attention: [held("org-a"), { tenantId: "org-b", status: "parked" }],
          },
        ]),
      ).toBe(1);
    });
  });
});

describe("migratedSplit()", () => {
  describe("when some of a step's migrated users wait on a person", () => {
    /** @scenario "Users waiting on a person are counted, not listed as needing attention" */
    it("counts them apart from the held ones", () => {
      expect(migratedSplit({ migrated: 5, waitingOnPerson: 3 })).toEqual({
        held: 2,
        waitingOnPerson: 3,
      });
    });

    /** @scenario "Users waiting on a person are counted, not listed as needing attention" */
    it("never takes the held count below zero when the two reads disagree", () => {
      expect(migratedSplit({ migrated: 2, waitingOnPerson: 3 })).toEqual({
        held: 0,
        waitingOnPerson: 2,
      });
    });
  });
});
