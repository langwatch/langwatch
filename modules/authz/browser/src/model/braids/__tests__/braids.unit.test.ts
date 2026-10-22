// Spec: modules/authz/specs/braids-screen.feature: what each viewer is offered, and plan states.

import { describe, expect, it } from "vitest";

import {
  braidAffordances,
  braidAuditHref,
  braidFromText,
  braidProject,
  braidsPlanState,
  braidsSigningKeysHref,
  braidsTabOf,
  organizationBraidRows,
  projectBraidRows,
  projectInitials,
  strandOf,
} from "../braids.ts";

const projects = [
  { id: "p-orch", name: "Web orchestrator" },
  { id: "p-spec", name: "Specialist agents" },
];

const braid = {
  braidId: "b-1",
  ownerProjectId: "p-spec",
  readerProjectId: "p-orch",
  where: '  attributes["orchestrator"] == "web" ',
  fromMs: 1_000,
  expiresAtMs: null,
  createdByUserId: "u-ana",
  createdAtMs: 2_000,
};

describe("braid rows", () => {
  it("names the reader on the owner's side and the owner on the reader's side", () => {
    const rows = projectBraidRows({
      braids: { intoOtherProjects: [braid], fromOtherProjects: [{ ...braid, braidId: "b-2" }] },
      projects,
    });
    expect(rows.into[0]?.otherProject.name).toBe("Web orchestrator");
    expect(rows.from[0]?.otherProject.name).toBe("Specialist agents");
    expect(rows.into[0]?.where).toBe('attributes["orchestrator"] == "web"');
  });

  it("treats a blank condition as every span", () => {
    const rows = projectBraidRows({
      braids: { intoOtherProjects: [{ ...braid, where: "  " }], fromOtherProjects: [] },
      projects,
    });
    expect(rows.into[0]?.where).toBeNull();
  });

  it("gives a project it cannot name a name, initials and a stable strand", () => {
    const project = braidProject({ projectId: "p-hidden", projects });
    expect(project.name).toBe("Another project");
    expect(project.initials).toBe("AP");
    expect(strandOf("p-hidden")).toBe(project.strand);
    expect(projectInitials("Web orchestrator")).toBe("WO");
  });
});

describe("plan state", () => {
  it("sells Braids below Enterprise with nothing braided, and pauses kept braids", () => {
    expect(braidsPlanState({ isEnterprise: true, braidCount: 0 })).toBe("enterprise");
    expect(braidsPlanState({ isEnterprise: false, braidCount: 0 })).toBe("upsell");
    expect(braidsPlanState({ isEnterprise: false, braidCount: 2 })).toBe("paused");
  });
});

describe("what the viewer may do", () => {
  it("offers an admin everything on Enterprise", () => {
    expect(
      braidAffordances({
        canManage: true,
        planState: "enterprise",
        keptToOrganizationAdmins: false,
      }),
    ).toEqual({ canCreate: true, canEditInto: true, canRemove: true, showKeptToAdminsNote: false });
  });

  it("offers a viewer without braids:manage nothing, and tells them when admins keep braids", () => {
    expect(
      braidAffordances({
        canManage: false,
        planState: "enterprise",
        keptToOrganizationAdmins: true,
      }),
    ).toEqual({
      canCreate: false,
      canEditInto: false,
      canRemove: false,
      showKeptToAdminsNote: true,
    });
  });

  it("keeps removal open while braids are paused", () => {
    expect(
      braidAffordances({ canManage: true, planState: "paused", keptToOrganizationAdmins: false }),
    ).toMatchObject({ canCreate: false, canEditInto: false, canRemove: true });
  });
});

describe("braidAuditHref", () => {
  it("opens the audit log on the braid as its target", () => {
    expect(braidAuditHref("grant_1")).toBe("/settings/audit-log?targetKind=braid&targetId=grant_1");
  });
});

describe("the Braids page's tab in the URL", () => {
  /** @scenario A link opens the Braids page on its Signing keys tab */
  it.each([
    ["keys", "keys"],
    ["from", "from"],
    [undefined, "into"],
    ["nonsense", "into"],
  ] as const)("opens %s as %s", (value, tab) => {
    expect(braidsTabOf(value)).toBe(tab);
  });

  /** @scenario A link opens the Braids page on its Signing keys tab */
  it("links another project's Signing keys tab through the project switch", () => {
    expect(braidsSigningKeysHref({ projectSlug: "checkout-web-x1" })).toBe(
      "/checkout-web-x1?return_to=%2Fsettings%2Fbraids%3Ftab%3Dkeys",
    );
  });
});

describe("when two braids on one pair start the same day", () => {
  const braid = (braidId: string, fromMs: number, readerProjectId = "p-orch") => ({
    braidId,
    ownerProjectId: "p-spec",
    readerProjectId,
    where: null,
    fromMs,
    expiresAtMs: null,
    createdByUserId: null,
    createdAtMs: 0,
  });
  const morning = Date.UTC(2026, 9, 1, 9, 30);
  const afternoon = Date.UTC(2026, 9, 1, 14, 0);

  /** @scenario Two braids on one pair from the same day show their start times */
  it("shows the time on both, and only the day on a braid alone on its pair", () => {
    const rows = projectBraidRows({
      braids: {
        intoOtherProjects: [
          braid("b-1", morning),
          braid("b-2", afternoon),
          braid("b-3", morning, "p-other"),
        ],
        fromOtherProjects: [],
      },
      projects: [],
    });

    expect(rows.into.map((row) => row.fromShowsTime)).toEqual([true, true, false]);
    expect(
      organizationBraidRows({
        braids: [braid("b-1", morning), braid("b-2", afternoon)],
        projects: [],
      }).map((row) => row.fromShowsTime),
    ).toEqual([true, true]);
    expect(braidFromText({ fromMs: morning, showsTime: true })).toMatch(
      /^From 1 Oct 2026, \d\d:\d\d$/,
    );
    expect(braidFromText({ fromMs: morning, showsTime: false })).toBe("From 1 Oct 2026");
  });
});
