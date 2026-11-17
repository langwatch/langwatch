// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingOrganizationMemberRepository } from "../memory.nurturing-organization-member.repository.ts";

describe("MemoryNurturingOrganizationMemberRepository.findMembershipsOfUsers", () => {
  it("returns every membership of the named users, in any organization, and no one else's", async () => {
    const members = MemoryNurturingOrganizationMemberRepository.create();
    const join = (organizationId: string, userId: string) =>
      members.recordMembershipChange({ organizationId, userId, change: "joined", at: 1_000 });
    await join("org-1", "user-1");
    await join("org-2", "user-1");
    await join("org-2", "user-2");
    await join("org-1", "user-3");

    const read = await members.findMembershipsOfUsers({ userIds: ["user-1", "user-2"] });

    expect(read.map(({ organizationId, userId }) => [organizationId, userId])).toEqual([
      ["org-1", "user-1"],
      ["org-2", "user-1"],
      ["org-2", "user-2"],
    ]);
  });
});
