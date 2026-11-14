// Spec: modules/authz/specs/braids-screen.feature: what each viewer is offered, and plan states.

import { describe, expect, it } from "vitest";

import {
  braidAffordances,
  braidAuditHref,
  braidProject,
  braidsPlanState,
  braidsSigningKeysHref,
  braidsSectionOf,
  organizationBraidRows,
  projectBraidRows,
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

  it("gives a project it cannot name a name, never a blank", () => {
    const project = braidProject({ projectId: "p-hidden", projects });
    expect(project).toEqual({ id: "p-hidden", name: "Another project" });
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
  it("opens the audit log on the braid, labelled by its two projects", () => {
    const href = braidAuditHref({
      braidId: "rolebinding_1",
      ownerName: "payments-agent",
      readerName: "checkout-web",
    });
    const query = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/settings/audit-log?")).toBe(true);
    expect(Object.fromEntries(query)).toEqual({
      targetKind: "braid",
      targetId: "rolebinding_1",
      targetLabel: "payments-agent → checkout-web",
    });
  });

  describe("when the owner's slug is known", () => {
    /** @scenario View in audit log from the reader's side opens the owner's project */
    it("switches to the owner's project, then opens the log on the braid", () => {
      const href = braidAuditHref({
        braidId: "rolebinding_1",
        ownerName: "payments-agent",
        readerName: "checkout-web",
        ownerSlug: "payments-agent-x1",
      });
      const [path, search] = href.split("?");
      const returnTo = new URLSearchParams(search).get("return_to") ?? "";

      expect(path).toBe("/payments-agent-x1");
      expect(returnTo.startsWith("/settings/audit-log?")).toBe(true);
      expect(new URLSearchParams(returnTo.split("?")[1]).get("targetId")).toBe("rolebinding_1");
    });
  });
});

describe("the Braids page's section in the URL", () => {
  /** @scenario A link opens the Braids page at its Signing keys */
  it.each([
    ["keys", "keys"],
    ["from", "from"],
    [undefined, undefined],
    ["nonsense", undefined],
  ] as const)("reads %s as %s", (value, section) => {
    expect(braidsSectionOf(value)).toBe(section);
  });

  /** @scenario A link opens the Braids page at its Signing keys */
  it("links another project's Signing keys through the project switch", () => {
    expect(braidsSigningKeysHref({ projectSlug: "checkout-web-x1" })).toBe(
      "/checkout-web-x1?return_to=%2Fsettings%2Fbraids%3Fsection%3Dkeys",
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
  });
});
