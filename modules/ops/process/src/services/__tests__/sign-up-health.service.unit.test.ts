/**
 * @vitest-environment node
 * The orphaned-organization rate, read from the organization and identity owners (D12).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { IdentityLookupApi } from "@langwatch/identity-contract";
import type { OrganizationApi, OrganizationFounding } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { SignUpHealthService } from "../sign-up-health.service.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1);

function founding(
  organizationId: string,
  founderUserId: string,
  joins: { organizationId: string; afterDays: number }[] = [],
): OrganizationFounding {
  return {
    organizationId,
    founderUserId,
    foundedAtMs: T0,
    founderMemberships: [
      { organizationId, joinedAtMs: T0 },
      ...joins.map((join) => ({
        organizationId: join.organizationId,
        joinedAtMs: T0 + join.afterDays * DAY,
      })),
    ],
  };
}

function serviceOver({
  founded,
  provedUserIds,
  asked = [],
}: {
  founded: OrganizationFounding[];
  provedUserIds: string[];
  asked?: unknown[];
}) {
  return SignUpHealthService.create({
    organizations: createApiFixture<Pick<OrganizationApi, "findFoundedBetween">>({
      findFoundedBetween: async (input) => {
        asked.push(input);
        return founded;
      },
    }),
    identity: createApiFixture<Pick<IdentityLookupApi, "findVerifiedDomainsByUserIds">>({
      findVerifiedDomainsByUserIds: async ({ userIds }) =>
        userIds
          .filter((userId) => provedUserIds.includes(userId))
          .map((userId) => ({ userId, domain: "acme.com" })),
    }),
  });
}

describe("reading sign-up health for a window", () => {
  /** @scenario "Organizations nobody meant to create are countable across the change" */
  it("counts a founding orphaned only when a proved founder joined elsewhere within thirty days", async () => {
    const asked: unknown[] = [];
    const service = serviceOver({
      founded: [
        founding("org_orphan", "sam", [{ organizationId: "org_team", afterDays: 3 }]),
        founding("org_late", "ana", [{ organizationId: "org_team", afterDays: 31 }]),
        founding("org_unproved", "lee", [{ organizationId: "org_team", afterDays: 1 }]),
        founding("org_kept", "kim"),
      ],
      provedUserIds: ["sam", "ana", "kim"],
      asked,
    });

    const health = await service.getSignUpHealth({ fromMs: T0, toMs: T0 + 7 * DAY });

    expect(health).toEqual({
      organizationsFounded: 4,
      orphanedOrganizations: 1,
      orphanedRate: 0.25,
      fromMs: T0,
      toMs: T0 + 7 * DAY,
    });
    expect(asked).toEqual([{ fromMs: T0, toMs: T0 + 7 * DAY, followUntilMs: T0 + 37 * DAY }]);
  });

  it("answers zero for a window with no founding", async () => {
    const health = await serviceOver({ founded: [], provedUserIds: [] }).getSignUpHealth({
      fromMs: T0,
      toMs: T0 + DAY,
    });

    expect(health).toMatchObject({
      organizationsFounded: 0,
      orphanedOrganizations: 0,
      orphanedRate: 0,
    });
  });
});
