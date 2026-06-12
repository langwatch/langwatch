import { describe, expect, it } from "vitest";

import {
  describeAudience,
  type EffectiveRestriction,
  isContentVisible,
  isContentVisibleToPublic,
  needsAudienceFacts,
  type ViewerFacts,
} from "../contentVisibility";
import {
  type Disposition,
  EMPTY_AUDIENCE,
  type ResolvedAudience,
} from "../dataPrivacy.types";

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
    /** @scenario Content restricted to admins is hidden from a plain member */
    it("hides it from a plain member", () => {
      expect(
        isContentVisible(
          eff("restrict", { admins: true }),
          viewer({ isAdmin: false }),
        ),
      ).toBe(false);
    });

    /** @scenario Content restricted to admins is visible to an admin */
    it("shows it to an admin", () => {
      expect(
        isContentVisible(
          eff("restrict", { admins: true }),
          viewer({ isAdmin: true }),
        ),
      ).toBe(true);
    });
  });

  describe("given content restricted to a group", () => {
    /** @scenario Content restricted to a group is visible to members of that group */
    it("shows it to a group member and hides it from a non-member", () => {
      const restriction = eff("restrict", { groupIds: ["security"] });
      expect(
        isContentVisible(restriction, viewer({ groupIds: ["security"] })),
      ).toBe(true);
      expect(
        isContentVisible(restriction, viewer({ groupIds: ["other"] })),
      ).toBe(false);
    });
  });

  describe("given content restricted to the Members role group", () => {
    /** @scenario Content restricted to the Members role group excludes admins and viewers */
    it("shows it only to holders of the member role", () => {
      const restriction = eff("restrict", { members: true });
      expect(
        isContentVisible(restriction, viewer({ isMemberRole: true })),
      ).toBe(true);
      expect(isContentVisible(restriction, viewer({ isAdmin: true }))).toBe(
        false,
      );
      expect(isContentVisible(restriction, viewer({ isViewer: true }))).toBe(
        false,
      );
    });
  });

  describe("given an empty audience", () => {
    /** @scenario An empty audience hides content from everyone including admins */
    it("hides it even from an admin", () => {
      expect(
        isContentVisible(eff("restrict", {}), viewer({ isAdmin: true })),
      ).toBe(false);
    });
  });

  describe("given content restricted to viewers", () => {
    /** @scenario Content restricted to viewers is visible to a viewer-role holder */
    it("shows it to a viewer-role holder and hides it from a plain member", () => {
      const restriction = eff("restrict", { viewers: true });
      expect(isContentVisible(restriction, viewer({ isViewer: true }))).toBe(
        true,
      );
      expect(isContentVisible(restriction, viewer({ isViewer: false }))).toBe(
        false,
      );
    });
  });

  describe("given content restricted to the project owner", () => {
    /** @scenario Only the owner of a personal project sees its content */
    it("shows it to the owner and hides it from an admin", () => {
      const restriction = eff("restrict", { projectOwner: true });
      expect(
        isContentVisible(restriction, viewer({ isProjectOwner: true })),
      ).toBe(true);
      expect(isContentVisible(restriction, viewer({ isAdmin: true }))).toBe(
        false,
      );
    });

    /** @scenario The owner-only audience can be widened with a chosen group */
    it("also shows it to a member of an extra chosen group", () => {
      const restriction = eff("restrict", {
        projectOwner: true,
        groupIds: ["super-admins"],
      });
      expect(
        isContentVisible(restriction, viewer({ groupIds: ["super-admins"] })),
      ).toBe(true);
      expect(isContentVisible(restriction, viewer({}))).toBe(false);
    });
  });

  describe("given all-members or captured content", () => {
    it("shows captured content to any member and hides everything from a non-member", () => {
      expect(isContentVisible(eff("capture"), viewer({ isMember: true }))).toBe(
        true,
      );
      expect(
        isContentVisible(
          eff("restrict", { allMembers: true }),
          viewer({ isMember: true }),
        ),
      ).toBe(true);
      expect(
        isContentVisible(eff("capture"), viewer({ isMember: false })),
      ).toBe(false);
    });

    it("treats dropped content as not visible", () => {
      expect(isContentVisible(eff("drop"), viewer({ isAdmin: true }))).toBe(
        false,
      );
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
    expect(isContentVisibleToPublic(eff("restrict", { admins: true }))).toBe(
      false,
    );
    expect(isContentVisibleToPublic(eff("drop"))).toBe(false);
  });
});
