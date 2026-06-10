import { describe, expect, it } from "vitest";

import {
  describeAudience,
  effectiveCategoryRestriction,
  isContentVisible,
  isContentVisibleToPublic,
  needsAudienceFacts,
  type EffectiveRestriction,
  type ViewerFacts,
} from "../contentVisibility";
import {
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedAudience,
  type ResolvedCategory,
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
  return { isAdmin: false, isMember: true, groupIds: [], departmentId: null, ...partial };
}

const restrictCategory = (a: Partial<ResolvedAudience>): ResolvedCategory => ({
  disposition: "restrict",
  audience: audience(a),
});
const captureCategory: ResolvedCategory = {
  disposition: "capture",
  audience: { ...EMPTY_AUDIENCE },
};

describe("isContentVisible", () => {
  describe("given content restricted to admins", () => {
    /** @scenario Content restricted to admins is hidden from a plain member */
    it("hides it from a plain member", () => {
      expect(
        isContentVisible(eff("restrict", { admins: true }), viewer({ isAdmin: false })),
      ).toBe(false);
    });

    /** @scenario Content restricted to admins is visible to an admin */
    it("shows it to an admin", () => {
      expect(
        isContentVisible(eff("restrict", { admins: true }), viewer({ isAdmin: true })),
      ).toBe(true);
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

  describe("given content restricted to a department", () => {
    /** @scenario Content restricted to a department is visible to members of that department */
    it("shows it to a member of that department", () => {
      const restriction = eff("restrict", { departmentIds: ["hr"] });
      expect(isContentVisible(restriction, viewer({ departmentId: "hr" }))).toBe(true);
      expect(isContentVisible(restriction, viewer({ departmentId: "eng" }))).toBe(false);
    });
  });

  describe("given an empty audience", () => {
    /** @scenario An empty audience hides content from everyone including admins */
    it("hides it even from an admin", () => {
      expect(isContentVisible(eff("restrict", {}), viewer({ isAdmin: true }))).toBe(false);
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

describe("effectiveCategoryRestriction", () => {
  it("lets an explicit restrict policy win over the legacy enum", () => {
    const result = effectiveCategoryRestriction(
      restrictCategory({ admins: true }),
      "VISIBLE_TO_ALL",
    );
    expect(result.disposition).toBe("restrict");
    expect(result.audience.admins).toBe(true);
  });

  it("falls back to the legacy VISIBLE_TO_ADMIN at the default disposition", () => {
    const result = effectiveCategoryRestriction(captureCategory, "VISIBLE_TO_ADMIN");
    expect(result.disposition).toBe("restrict");
    expect(result.audience.admins).toBe(true);
  });

  it("falls back to the legacy REDACTED_TO_ALL as a no-one restriction", () => {
    const result = effectiveCategoryRestriction(captureCategory, "REDACTED_TO_ALL");
    expect(result.disposition).toBe("restrict");
    expect(result.audience).toEqual(EMPTY_AUDIENCE);
  });

  it("stays captured when the legacy enum is VISIBLE_TO_ALL", () => {
    expect(
      effectiveCategoryRestriction(captureCategory, "VISIBLE_TO_ALL").disposition,
    ).toBe("capture");
  });
});

describe("describeAudience", () => {
  /** @scenario The redaction placeholder explains why content is hidden */
  it("names the audience that can see restricted content", () => {
    expect(
      describeAudience(audience({ admins: true, groupIds: ["g1"] }), {
        groups: { g1: "Security" },
        departments: {},
      }),
    ).toBe("Admins, Security");
    expect(describeAudience(audience({}), { groups: {}, departments: {} })).toBe("no one");
  });
});

describe("needsAudienceFacts and isContentVisibleToPublic", () => {
  it("needs membership facts only for group/department restrictions", () => {
    expect(needsAudienceFacts(eff("restrict", { groupIds: ["g"] }))).toBe(true);
    expect(needsAudienceFacts(eff("restrict", { departmentIds: ["d"] }))).toBe(true);
    expect(needsAudienceFacts(eff("restrict", { admins: true }))).toBe(false);
    expect(needsAudienceFacts(eff("capture"))).toBe(false);
  });

  it("shows a public viewer only captured content", () => {
    expect(isContentVisibleToPublic(eff("capture"))).toBe(true);
    expect(isContentVisibleToPublic(eff("restrict", { admins: true }))).toBe(false);
    expect(isContentVisibleToPublic(eff("drop"))).toBe(false);
  });
});
