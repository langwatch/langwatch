/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";
import { MemoryTeamRepository } from "../memory/memory.team.repository.ts";

function joined({
  memory,
  organizationId,
  atMs,
  disabled = false,
}: {
  memory: MemoryOrganizationDatabase;
  organizationId: string;
  atMs: number;
  disabled?: boolean;
}) {
  const at = Temporal.Instant.fromEpochMilliseconds(atMs);
  memory.organizationUsers.push({
    userId: "user_1",
    organizationId,
    role: "MEMBER",
    disabledAt: disabled ? at : null,
    createdAt: at,
    updatedAt: at,
  });
}

describe("MemoryTeamRepository.mostRecentOrganizationIdForMember", () => {
  /** @scenario "A person's most recently joined organization is read across tenants" */
  it("answers the newest active membership's organization", async () => {
    const memory = MemoryOrganizationDatabase.create();
    joined({ memory, organizationId: "org_first", atMs: 1_000 });
    joined({ memory, organizationId: "org_last", atMs: 3_000 });
    joined({ memory, organizationId: "org_disabled", atMs: 4_000, disabled: true });
    joined({ memory, organizationId: "org_middle", atMs: 2_000 });

    await expect(
      MemoryTeamRepository.create({ memory }).mostRecentOrganizationIdForMember({
        userId: "user_1",
      }),
    ).resolves.toEqual({ outcome: "member", organizationId: "org_last" });
  });

  /** @scenario "A person's most recently joined organization is read across tenants" */
  it("answers none for a person with no active membership", async () => {
    const memory = MemoryOrganizationDatabase.create();
    joined({ memory, organizationId: "org_disabled", atMs: 1_000, disabled: true });

    await expect(
      MemoryTeamRepository.create({ memory }).mostRecentOrganizationIdForMember({
        userId: "user_1",
      }),
    ).resolves.toEqual({ outcome: "none" });
  });
});
