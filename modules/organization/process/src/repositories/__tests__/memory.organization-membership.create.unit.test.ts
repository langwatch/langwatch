/**
 * @vitest-environment node
 * The membership insert an automatic arrival makes, over the memory tier: one
 * row on the joiner seat (MEMBER with the grant intent, DEVELOPER without),
 * and a second call that is not a failure.
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ORGANIZATION_ID = "org_arrival";
const USER_ID = "user_arrival";

function harness({ joinerRole }: { joinerRole?: "MEMBER" | "DEVELOPER" } = {}) {
  const memory = MemoryOrganizationDatabase.create();
  const at = Temporal.Instant.fromEpochMilliseconds(1_756_000_000_000);
  memory.organizations.set(ORGANIZATION_ID, {
    id: ORGANIZATION_ID,
    name: ORGANIZATION_ID,
    slug: ORGANIZATION_ID,
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    joinerRole,
    createdAt: at,
    updatedAt: at,
  });
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
        via: "sso",
      }),
    ).resolves.toEqual({ outcome: "created", seat: "MEMBER" });

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
      via: "sso" as const,
    };

    await repository.createMembership(membership);

    await expect(
      repository.createMembership({ ...membership, pendingAdmissionId: "rolebinding_2" }),
    ).resolves.toEqual({ outcome: "already-present", seat: "MEMBER" });
    expect(memory.organizationUsers).toHaveLength(1);
    expect(memory.organizationUsers[0]?.pendingSsoGrantId).toBe("rolebinding_1");
  });

  describe("when the organization hands joiners a Developer seat (ADR-171)", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes one DEVELOPER row carrying no admission intent", async () => {
      const { memory, repository } = harness({ joinerRole: "DEVELOPER" });

      await expect(
        repository.createMembership({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          pendingAdmissionId: "rolebinding_1",
          via: "sso",
        }),
      ).resolves.toEqual({ outcome: "created", seat: "DEVELOPER" });
      expect(memory.organizationUsers[0]).toMatchObject({
        role: "DEVELOPER",
        pendingSsoGrantId: null,
      });
    });
  });
});
