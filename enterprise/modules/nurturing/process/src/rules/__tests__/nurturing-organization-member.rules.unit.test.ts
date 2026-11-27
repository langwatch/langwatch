// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import {
  isCurrentMembership,
  membersWhoseLatestOrganizationIs,
  membersWhoseLatestOrganizationIsElsewhere,
  type NurturingMembership,
} from "../nurturing-organization-member.rules.ts";

const membership = (overrides: Partial<NurturingMembership>): NurturingMembership => ({
  organizationId: "org-1",
  userId: "user-1",
  joinedAt: 1_000,
  leftAt: null,
  returnedAt: null,
  ...overrides,
});

describe("isCurrentMembership()", () => {
  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it.each([
    ["a join", {}, true],
    ["a join and a later leave", { leftAt: 2_000 }, false],
    ["a leave and a later return", { leftAt: 2_000, returnedAt: 3_000 }, true],
    ["a leave after the return", { leftAt: 4_000, returnedAt: 3_000 }, false],
    ["a rejoin after a leave", { joinedAt: 5_000, leftAt: 2_000 }, true],
    ["a return with no join seen", { joinedAt: null, returnedAt: 3_000 }, false],
  ])("answers whether %s is current", (_name, overrides, current) => {
    expect(isCurrentMembership(membership(overrides))).toBe(current);
  });
});

describe("membersWhoseLatestOrganizationIs()", () => {
  /** @scenario "A member who joined another organization since does not get this one's traits" */
  it("keeps the members whose current membership with the latest join is this one", () => {
    const memberships = [
      membership({ userId: "stays" }),
      membership({ userId: "moved" }),
      membership({ userId: "moved", organizationId: "org-2", joinedAt: 2_000 }),
      membership({ userId: "left-the-other" }),
      membership({
        userId: "left-the-other",
        organizationId: "org-2",
        joinedAt: 2_000,
        leftAt: 3_000,
      }),
      membership({ userId: "left", leftAt: 2_000 }),
    ];

    expect(membersWhoseLatestOrganizationIs({ memberships, organizationId: "org-1" })).toEqual([
      "stays",
      "left-the-other",
    ]);
  });
});

describe("membersWhoseLatestOrganizationIsElsewhere()", () => {
  const elsewhereOf = (memberships: NurturingMembership[]) =>
    membersWhoseLatestOrganizationIsElsewhere({ memberships, organizationId: "org-1" });

  /** @scenario "A member current in another organization is not told this plan" */
  it("names a member whose latest current membership is another organization", () => {
    expect(
      elsewhereOf([
        membership({ userId: "moved" }),
        membership({ userId: "moved", organizationId: "org-2", joinedAt: 2_000 }),
      ]),
    ).toEqual(["moved"]);
  });

  it("names a member whose only row is a current one in another organization", () => {
    expect(elsewhereOf([membership({ userId: "only-there", organizationId: "org-2" })])).toEqual([
      "only-there",
    ]);
  });

  it("does not name a member the copy holds no row for", () => {
    expect(elsewhereOf([])).toEqual([]);
  });

  it("does not name a member current only here", () => {
    expect(elsewhereOf([membership({ userId: "stays" })])).toEqual([]);
  });

  it("does not name a member who left here and is current nowhere: no other plan is theirs", () => {
    expect(
      elsewhereOf([
        membership({ userId: "left", leftAt: 2_000 }),
        membership({ userId: "left", organizationId: "org-2", joinedAt: 500, leftAt: 600 }),
      ]),
    ).toEqual([]);
  });

  it("names a member who left here and is current in another organization", () => {
    expect(
      elsewhereOf([
        membership({ userId: "left", leftAt: 2_000 }),
        membership({ userId: "left", organizationId: "org-2", joinedAt: 500 }),
      ]),
    ).toEqual(["left"]);
  });
});

describe("when a member is current in two organizations joined at the same time", () => {
  const tied = [
    membership({ userId: "tied", organizationId: "org-1", joinedAt: 1_000 }),
    membership({ userId: "tied", organizationId: "org-0", joinedAt: 1_000 }),
  ];

  it("breaks the tie by organization id, so org-0 is their latest", () => {
    const of = (organizationId: string) => ({ memberships: tied, organizationId });

    expect(membersWhoseLatestOrganizationIsElsewhere(of("org-1"))).toEqual(["tied"]);
    expect(membersWhoseLatestOrganizationIs(of("org-0"))).toEqual(["tied"]);
  });
});
