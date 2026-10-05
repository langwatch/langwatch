/**
 * @vitest-environment node
 * The membership insert an automatic arrival makes, over the memory tier: one
 * row on the organization's joiner seat, carrying the grant intent for a Full
 * member, and a second call that is not a failure.
 */
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ORGANIZATION_ID = "org_arrival";
const USER_ID = "user_arrival";
const ADMISSION = { via: "sso" } as const;

function harness({ joinerRole }: { joinerRole?: "MEMBER" | "DEVELOPER" } = {}) {
  const memory = MemoryOrganizationDatabase.create();
  const now = nowInstant();
  memory.organizations.set(ORGANIZATION_ID, {
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    ...(joinerRole ? { joinerRole } : {}),
    createdAt: now,
    updatedAt: now,
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
        admission: ADMISSION,
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
    expect(memory.auditLogs).toHaveLength(0);
  });

  it("answers a row a concurrent callback already wrote, leaving its intent alone", async () => {
    const { memory, repository } = harness();
    const membership = {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      pendingAdmissionId: "rolebinding_1",
      admission: ADMISSION,
    };

    await repository.createMembership(membership);

    await expect(
      repository.createMembership({ ...membership, pendingAdmissionId: "rolebinding_2" }),
    ).resolves.toEqual({ outcome: "already-present", seat: "MEMBER" });
    expect(memory.organizationUsers).toHaveLength(1);
    expect(memory.organizationUsers[0]?.pendingSsoGrantId).toBe("rolebinding_1");
  });

  describe("when the organization's joiner seat is Developer", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes a Developer row with no admission intent, and audits the admission", async () => {
      const { memory, repository } = harness({ joinerRole: "DEVELOPER" });

      await expect(
        repository.createMembership({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          pendingAdmissionId: "rolebinding_1",
          admission: ADMISSION,
        }),
      ).resolves.toEqual({ outcome: "created", seat: "DEVELOPER" });

      expect(memory.organizationUsers[0]).toMatchObject({
        role: "DEVELOPER",
        pendingSsoGrantId: null,
      });
      expect(memory.auditLogs).toEqual([
        expect.objectContaining({
          action: "organization.member.admitted",
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
        }),
      ]);
    });
  });
});
