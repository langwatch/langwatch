/**
 * The Billing role's service over the memory Grant head.
 * Spec: specs/licensing/billing-role.feature
 */
import { BILLING_ROLE_KEY } from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzBillingGrantRepository } from "../../repositories/memory/memory.authz-billing-grant.repository.ts";
import { MemoryAuthzUserStandingRepository } from "../../repositories/memory/memory.authz-user-standing.repository.ts";
import { AuthzBillingRoleService, type BillingGrantLedger } from "../authz-billing-role.service.ts";

const ORG = "org-1";
const MEMBER = "user-member";
const ADMIN = { type: "user" as const, id: "user-admin" };

/** Writes the Grant head the projection would, so reads see what the ledger wrote. */
function memoryLedger(memory: AuthzMemoryStore): BillingGrantLedger {
  return {
    async attachBillingGrant({ organizationId, grantId, userId, source }) {
      const now = nowInstant();
      memory.grants.push({
        id: grantId,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: BILLING_ROLE_KEY,
        legacyRole: null,
        source,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: now,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        revokedReason: null,
      });
    },
    async revokeBillingGrants({ grantIds }) {
      for (const row of memory.grants) {
        if (grantIds.includes(row.id)) row.revokedAt = nowInstant();
      }
    },
  };
}

function addMember({
  memory,
  userId,
  disabled = false,
}: {
  memory: AuthzMemoryStore;
  userId: string;
  disabled?: boolean;
}) {
  memory.memberships.set(memory.membershipKey(ORG, userId), {
    role: "MEMBER",
    disabled,
    membershipStamp: `stamp-${userId}`,
    pendingSsoGrantId: null,
    createdAt: nowInstant(),
  });
}

describe("AuthzBillingRoleService", () => {
  let memory: AuthzMemoryStore;
  let service: AuthzBillingRoleService;
  let nextId: number;

  beforeEach(() => {
    memory = AuthzMemoryStore.create();
    nextId = 0;
    service = AuthzBillingRoleService.create({
      grants: MemoryAuthzBillingGrantRepository.create({ memory }),
      standings: MemoryAuthzUserStandingRepository.create({ memory }),
      ledger: memoryLedger(memory),
      newGrantId: () => `grant-${++nextId}`,
    });
  });

  /** @scenario "Admin grants and revokes Billing" */
  it("grants once, keeps one grant on a repeat, and revokes", async () => {
    addMember({ memory, userId: MEMBER });

    await service.setRole({ organizationId: ORG, userId: MEMBER, holds: true, actor: ADMIN });
    expect(await service.listMembers({ organizationId: ORG })).toEqual([{ userId: MEMBER }]);

    await service.setRole({ organizationId: ORG, userId: MEMBER, holds: true, actor: ADMIN });
    expect(memory.grants.filter((row) => row.revokedAt === null)).toHaveLength(1);

    await service.setRole({ organizationId: ORG, userId: MEMBER, holds: false, actor: ADMIN });
    expect(await service.listMembers({ organizationId: ORG })).toEqual([]);
  });

  /** @scenario "A disabled member is not listed as a Billing holder" */
  it("leaves a disabled member out of the holders", async () => {
    addMember({ memory, userId: MEMBER, disabled: true });
    await service.setRole({ organizationId: ORG, userId: MEMBER, holds: true, actor: ADMIN });

    expect(await service.listMembers({ organizationId: ORG })).toEqual([]);
  });
});
