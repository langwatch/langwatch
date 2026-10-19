/**
 * @vitest-environment node
 * The memory seat twin leaves a deactivated person out of the pool, as Postgres does.
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationSeatRepository } from "../memory/memory.organization-seat.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  const people = [
    ["ada", OrganizationUserRole.ADMIN, false, false],
    ["grace", OrganizationUserRole.MEMBER, true, false],
    ["linus", OrganizationUserRole.MEMBER, false, true],
    ["mia", OrganizationUserRole.MEMBER, false, false],
  ] as const;
  for (const [userId, role, deactivated, disabled] of people) {
    memory.users.set(userId, {
      id: userId,
      name: userId,
      email: `${userId}@acme.com`,
      deactivatedAt: deactivated ? EPOCH : null,
    });
    memory.organizationUsers.push({
      userId,
      organizationId: ACME,
      role,
      disabledAt: disabled ? EPOCH : null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
  return MemoryOrganizationSeatRepository.create({ memory });
}

describe("the memory seat twin on a deactivated person", () => {
  it("counts neither the deactivated person nor the disabled membership", async () => {
    const seats = seeded();

    expect(await seats.getMemberCount(ACME)).toBe(2);
  });
});
