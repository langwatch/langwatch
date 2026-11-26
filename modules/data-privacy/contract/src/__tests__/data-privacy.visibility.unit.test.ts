import { describe, expect, it } from "vitest";

import { type Disposition, EMPTY_AUDIENCE, type ResolvedAudience } from "../data-privacy.ts";
import {
  describeAudience,
  type EffectiveRestriction,
  isContentVisible,
  isContentVisibleToPublic,
  needsAudienceFacts,
  ownsEveryGovernedProject,
  viewerFactsFrom,
  type ViewerFacts,
} from "../data-privacy.visibility.ts";

function audience(partial: Partial<ResolvedAudience>): ResolvedAudience {
  return { ...EMPTY_AUDIENCE, ...partial };
}

function eff(
  disposition: Disposition,
  partial: Partial<ResolvedAudience> = {},
): EffectiveRestriction {
  return { disposition, audience: audience(partial) };
}

function viewer(partial: Partial<ViewerFacts>): ViewerFacts {
  return {
    isAdmin: false,
    isMember: true,
    isMemberRole: false,
    isViewer: false,
    isProjectOwner: false,
    groupIds: [],
    ...partial,
  };
}

describe("isContentVisible", () => {
  describe("given content restricted to admins", () => {
    /**
     * @scenario Content restricted to admins is hidden from a plain member
     * @scenario System instructions restricted to admins are hidden from a plain member
     *
     * The resolution is category-agnostic: whichever content category
     * resolved to this restriction, the audience check is identical.
     */
    it("hides it from a plain member", () => {
      expect(isContentVisible(eff("restrict", { admins: true }), viewer({ isAdmin: false }))).toBe(
        false,
      );
    });

    /**
     * @scenario Content restricted to admins is visible to an admin
     * @scenario System instructions restricted to admins are visible to an admin
     */
    it("shows it to an admin", () => {
      expect(isContentVisible(eff("restrict", { admins: true }), viewer({ isAdmin: true }))).toBe(
        true,
      );
    });
  });

  describe("given content restricted to a group", () => {
    /** @scenario Content restricted to a group is visible to members of that group */
    it("shows it to a group member and hides it from a non-member", () => {
      const restriction = eff("restrict", { groupIds: ["security"] });
      expect(isContentVisible(restriction, viewer({ groupIds: ["security"] }))).toBe(true);
      expect(isContentVisible(restriction, viewer({ groupIds: ["other"] }))).toBe(false);
    });
  });

  describe("given content restricted to the Members role group", () => {
    /** @scenario Content restricted to the Members role group excludes admins and viewers */
    it("shows it only to holders of the member role", () => {
      const restriction = eff("restrict", { members: true });
      expect(isContentVisible(restriction, viewer({ isMemberRole: true }))).toBe(true);
      expect(isContentVisible(restriction, viewer({ isAdmin: true }))).toBe(false);
      expect(isContentVisible(restriction, viewer({ isViewer: true }))).toBe(false);
    });
  });

  describe("given an empty audience", () => {
    /** @scenario An empty audience hides content from everyone including admins */
    it("hides it even from an admin", () => {
      expect(isContentVisible(eff("restrict", {}), viewer({ isAdmin: true }))).toBe(false);
    });
  });

  describe("given content restricted to viewers", () => {
    /** @scenario Content restricted to viewers is visible to a viewer-role holder */
    it("shows it to a viewer-role holder and hides it from a plain member", () => {
      const restriction = eff("restrict", { viewers: true });
      expect(isContentVisible(restriction, viewer({ isViewer: true }))).toBe(true);
      expect(isContentVisible(restriction, viewer({ isViewer: false }))).toBe(false);
    });
  });

  describe("given content restricted to the project owner", () => {
    /** @scenario Only the owner of a personal project sees its content */
    it("shows it to the owner and hides it from an admin", () => {
      const restriction = eff("restrict", { projectOwner: true });
      expect(isContentVisible(restriction, viewer({ isProjectOwner: true }))).toBe(true);
      expect(isContentVisible(restriction, viewer({ isAdmin: true }))).toBe(false);
    });

    /** @scenario The owner-only audience can be widened with a chosen group */
    it("also shows it to a member of an extra chosen group", () => {
      const restriction = eff("restrict", {
        projectOwner: true,
        groupIds: ["super-admins"],
      });
      expect(isContentVisible(restriction, viewer({ groupIds: ["super-admins"] }))).toBe(true);
      expect(isContentVisible(restriction, viewer({}))).toBe(false);
    });
  });

  describe("given all-members or captured content", () => {
    it("shows captured content to any member and hides everything from a non-member", () => {
      expect(isContentVisible(eff("capture"), viewer({ isMember: true }))).toBe(true);
      expect(
        isContentVisible(eff("restrict", { allMembers: true }), viewer({ isMember: true })),
      ).toBe(true);
      expect(isContentVisible(eff("capture"), viewer({ isMember: false }))).toBe(false);
    });

    it("treats dropped content as not visible", () => {
      expect(isContentVisible(eff("drop"), viewer({ isAdmin: true }))).toBe(false);
    });
  });
});

describe("describeAudience", () => {
  /** @scenario The redaction placeholder explains why content is hidden */
  it("names the audience that can see restricted content", () => {
    expect(
      describeAudience(audience({ admins: true, groupIds: ["g1"] }), {
        groups: { g1: "Security" },
      }),
    ).toBe("Admins, Security");
    expect(
      describeAudience(audience({ viewers: true, projectOwner: true }), {
        groups: {},
      }),
    ).toBe("Viewers, the project owner");
    expect(describeAudience(audience({}), { groups: {} })).toBe("no one");
  });
});

describe("needsAudienceFacts and isContentVisibleToPublic", () => {
  it("needs membership facts only for group restrictions", () => {
    expect(needsAudienceFacts(eff("restrict", { groupIds: ["g"] }))).toBe(true);
    expect(needsAudienceFacts(eff("restrict", { admins: true }))).toBe(false);
    expect(needsAudienceFacts(eff("capture"))).toBe(false);
  });

  it("shows a public viewer only captured content", () => {
    expect(isContentVisibleToPublic(eff("capture"))).toBe(true);
    expect(isContentVisibleToPublic(eff("restrict", { admins: true }))).toBe(false);
    expect(isContentVisibleToPublic(eff("drop"))).toBe(false);
  });
});

describe("viewerFactsFrom", () => {
  const facts = (held: { view: boolean; update: boolean; manage: boolean }) =>
    viewerFactsFrom({
      held: {
        "traces:view": held.view,
        "traces:update": held.update,
        "project:manage": held.manage,
      },
      isProjectOwner: false,
      groupIds: [],
    });

  describe("given a project Member, who writes traces but does not manage the project", () => {
    it("reads them as the Members role, not as an admin", () => {
      expect(facts({ view: true, update: true, manage: false })).toMatchObject({
        isAdmin: false,
        isMemberRole: true,
        isViewer: false,
      });
    });

    it("hides content restricted to admins from them", () => {
      const viewer = facts({ view: true, update: true, manage: false });
      expect(isContentVisible(eff("restrict", { admins: true }), viewer)).toBe(false);
    });
  });

  describe("given a project Admin", () => {
    it("reads them as an admin, not as the Members role", () => {
      expect(facts({ view: true, update: true, manage: true })).toMatchObject({
        isAdmin: true,
        isMemberRole: false,
        isViewer: false,
      });
    });
  });

  describe("given a Viewer, who only reads traces", () => {
    it("reads them as a viewer", () => {
      expect(facts({ view: true, update: false, manage: false })).toMatchObject({
        isAdmin: false,
        isMemberRole: false,
        isViewer: true,
      });
    });
  });
});

describe("ownsEveryGovernedProject", () => {
  const owners: Record<string, string | null> = { a: "user-1", b: "user-1", c: "user-2", d: null };
  const ownerOf = async (projectId: string) => owners[projectId];
  const noFailure = () => {
    throw new Error("no lookup was expected to fail");
  };

  it("counts the viewer as owner when they own every project the read spans", async () => {
    await expect(
      ownsEveryGovernedProject({
        userId: "user-1",
        projectIds: ["a", "b"],
        ownerOf,
        onLookupFailure: noFailure,
      }),
    ).resolves.toBe(true);
  });

  /** @scenario "Owner-only content stays hidden when a read spans a project the viewer does not own" */
  it("does not when one spanned project belongs to someone else", async () => {
    await expect(
      ownsEveryGovernedProject({
        userId: "user-1",
        projectIds: ["a", "c"],
        ownerOf,
        onLookupFailure: noFailure,
      }),
    ).resolves.toBe(false);
  });

  it("does not when a project has no owner, or no project is named", async () => {
    for (const projectIds of [["d"], []]) {
      await expect(
        ownsEveryGovernedProject({
          userId: "user-1",
          projectIds,
          ownerOf,
          onLookupFailure: noFailure,
        }),
      ).resolves.toBe(false);
    }
  });

  it("does not for a caller with no user", async () => {
    await expect(
      ownsEveryGovernedProject({
        userId: undefined,
        projectIds: ["a"],
        ownerOf,
        onLookupFailure: noFailure,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed and reports the failure when an owner lookup throws", async () => {
    const failures: unknown[] = [];
    await expect(
      ownsEveryGovernedProject({
        userId: "user-1",
        projectIds: ["a"],
        ownerOf: () => Promise.reject(new Error("projects unreadable")),
        onLookupFailure: (error) => failures.push(error),
      }),
    ).resolves.toBe(false);
    expect(failures).toHaveLength(1);
  });
});
