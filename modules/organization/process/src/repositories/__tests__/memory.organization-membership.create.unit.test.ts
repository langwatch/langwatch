/**
 * @vitest-environment node
 * The membership insert an automatic arrival makes, over the memory tier: one
 * MEMBER row carrying the grant intent, and a second call that is not a
 * failure.
 */
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ORGANIZATION_ID = "org_arrival";
const USER_ID = "user_arrival";

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  return { memory, repository: MemoryOrganizationMembershipRepository.create({ memory }) };
}

describe("creating a membership for an arriving person", () => {
  it("writes one MEMBER row carrying the admission intent", async () => {
    const { memory, repository } = harness();

    await expect(
      repository.createMembership({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        pendingAdmissionId: "rolebinding_1",
      }),
    ).resolves.toBe("created");

    expect(memory.organizationUsers).toHaveLength(1);
    expect(memory.organizationUsers[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role: "MEMBER",
      disabledAt: null,
      pendingSsoGrantId: "rolebinding_1",
    });
  });

  it("answers a row a concurrent callback already wrote, leaving its intent alone", async () => {
    const { memory, repository } = harness();
    const membership = {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      pendingAdmissionId: "rolebinding_1",
    };

    await repository.createMembership(membership);

    await expect(
      repository.createMembership({ ...membership, pendingAdmissionId: "rolebinding_2" }),
    ).resolves.toBe("already-present");
    expect(memory.organizationUsers).toHaveLength(1);
    expect(memory.organizationUsers[0]?.pendingSsoGrantId).toBe("rolebinding_1");
  });
});
