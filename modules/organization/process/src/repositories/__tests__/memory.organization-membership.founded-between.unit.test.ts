/**
 * @vitest-environment node
 * The organizations founded in a window, each with its founder and where they went next (D12).
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1);

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  const organization = (id: string, createdAtMs: number) => {
    const at = Temporal.Instant.fromEpochMilliseconds(createdAtMs);
    memory.organizations.set(id, {
      id,
      name: id,
      slug: id,
      supportContact: null,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      stripeCustomerId: null,
      createdAt: at,
      updatedAt: at,
    });
  };
  const joins = (userId: string, organizationId: string, atMs: number) => {
    const at = Temporal.Instant.fromEpochMilliseconds(atMs);
    memory.organizationUsers.push({
      userId,
      organizationId,
      role: OrganizationUserRole.ADMIN,
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
    });
  };
  return {
    organization,
    joins,
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
  };
}

describe("reading the organizations founded in a window", () => {
  it("names each founder and every membership they took up before the follow-up ends", async () => {
    const { organization, joins, repository } = harness();
    organization("org_solo", T0 + DAY);
    organization("org_team", T0 - 10 * DAY);
    organization("org_before", T0 - DAY);
    joins("sam", "org_solo", T0 + DAY);
    joins("ana", "org_team", T0 - 10 * DAY);
    joins("sam", "org_team", T0 + 3 * DAY);
    joins("lee", "org_before", T0 - DAY);

    const founded = await repository.findFoundedBetween({
      fromMs: T0,
      toMs: T0 + 7 * DAY,
      followUntilMs: T0 + 37 * DAY,
    });

    expect(founded).toEqual([
      {
        organizationId: "org_solo",
        founderUserId: "sam",
        foundedAtMs: T0 + DAY,
        founderMemberships: [
          { organizationId: "org_solo", joinedAtMs: T0 + DAY },
          { organizationId: "org_team", joinedAtMs: T0 + 3 * DAY },
        ],
      },
    ]);
  });
});
