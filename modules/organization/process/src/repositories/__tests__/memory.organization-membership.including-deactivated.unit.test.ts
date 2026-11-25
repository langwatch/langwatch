import { OrganizationUserRole } from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 * The member read governance's identity match takes: every row, whatever its state.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  const member = (userId: string, organizationId: string, disabled: boolean) => {
    memory.organizationUsers.push({
      userId,
      organizationId,
      role: OrganizationUserRole.MEMBER,
      disabledAt: disabled ? EPOCH : null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  };
  const person = (id: string, deactivated: boolean) => {
    memory.users.set(id, {
      id,
      name: id,
      email: `${id}@acme.com`,
      deactivatedAt: deactivated ? EPOCH : null,
    });
  };
  return {
    memory,
    member,
    person,
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
  };
}

describe("reading every member including the deactivated", () => {
  it("answers active, disabled and deactivated members of the organization only", async () => {
    const { member, person, repository } = harness();
    person("ada", false);
    person("grace", true);
    person("linus", false);
    person("mallory", false);
    member("ada", ACME, false);
    member("grace", ACME, false);
    member("linus", ACME, true);
    member("mallory", "org_elsewhere", false);

    const members = await repository.findMemberUsersIncludingDeactivated({ organizationId: ACME });
    const active = await repository.findActiveMemberUsers(ACME);

    expect(members.map((user) => user.id).toSorted()).toEqual(["ada", "grace", "linus"]);
    expect(active.map((user) => user.id)).toEqual(["ada"]);
  });
});
