// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  isCurrentMembership,
  membersWhoseLatestOrganizationIs,
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
