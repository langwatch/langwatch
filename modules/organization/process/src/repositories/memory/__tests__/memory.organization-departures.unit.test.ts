/**
 * The memory twin answers departures the way the live reader does: only full seats count.
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDeparturesRepository } from "../memory.organization-departures.repository.ts";
import { MemoryOrganizationMembershipRepository } from "../memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";

const ORGANIZATION = "org_acme";
const at = Temporal.Instant.from("2026-10-10T00:00:00Z");

function seeded(members: { userId: string; role: "ADMIN" | "MEMBER" | "EXTERNAL" }[]) {
  const memory = MemoryOrganizationDatabase.create();
  for (const { userId, role } of members) {
    memory.organizationUsers.push({
      userId,
      organizationId: ORGANIZATION,
      role,
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  return {
    memberships: MemoryOrganizationMembershipRepository.create({ memory }),
    departures: MemoryOrganizationDeparturesRepository.create({ memory }),
  };
}

describe("memory organization departures", () => {
  /** @scenario "Only departures that held a full seat count, older facts count as before" */
  it("counts a removed or disabled full-seat member, never an external one", async () => {
    const { memberships, departures } = seeded([
      { userId: "user_ana", role: "ADMIN" },
      { userId: "user_ben", role: "MEMBER" },
      { userId: "user_cy", role: "MEMBER" },
      { userId: "user_eve", role: "EXTERNAL" },
      { userId: "user_fay", role: "EXTERNAL" },
    ]);

    await memberships.deleteMember({
      organizationId: ORGANIZATION,
      userId: "user_ben",
      actingUserId: "user_ana",
    });
    await memberships.deleteMember({
      organizationId: ORGANIZATION,
      userId: "user_eve",
      actingUserId: "user_ana",
    });
    await memberships.setMemberDisabled({
      organizationId: ORGANIZATION,
      userId: "user_cy",
      disabled: true,
    });
    await memberships.setMemberDisabled({
      organizationId: ORGANIZATION,
      userId: "user_fay",
      disabled: true,
    });

    const departed = await departures.findDepartedSince({
      organizationId: ORGANIZATION,
      since: 0,
    });

    expect(departed.toSorted()).toEqual(["user_ben", "user_cy"]);
  });
});
