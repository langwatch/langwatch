/**
 * The Billing role's service over the memory Grant head.
 * Spec: specs/licensing/billing-role.feature
 */
import {
  BILLING_ROLE_KEY,
  GrantExceedsCallerPermissionsError,
  type AuthzFindPermissionsBeyondCallerInput,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzBillingGrantRepository } from "../../repositories/memory/memory.authz-billing-grant.repository.ts";
import { MemoryAuthzUserStandingRepository } from "../../repositories/memory/memory.authz-user-standing.repository.ts";
import { AuthzBillingRoleService, type BillingGrantLedger } from "../authz-billing-role.service.ts";

const ORG = "org-1";
const MEMBER = "user-member";
const ADMIN = { type: "user" as const, id: "user-admin" };
const ORG_MANAGER = { type: "user" as const, id: "user-org-manager" };

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
  let lacking: Map<string, string[]>;
  let asked: AuthzFindPermissionsBeyondCallerInput[];

  beforeEach(() => {
    lacking = new Map();
    asked = [];
    memory = AuthzMemoryStore.create();
    nextId = 0;
    service = AuthzBillingRoleService.create({
      grants: MemoryAuthzBillingGrantRepository.create({ memory }),
      standings: MemoryAuthzUserStandingRepository.create({ memory }),
      ledger: memoryLedger(memory),
      permissions: {
        async findPermissionsBeyondCaller(input) {
          asked.push(input);
          const callerId = input.caller.type === "anonymous" ? "" : input.caller.id;
          const missing = lacking.get(callerId) ?? [];
          return input.permissions.filter((permission) => missing.includes(permission));
        },
      },
      newGrantId: () => `grant-${++nextId}`,
    });
  });

  /** @scenario "Admin grants and revokes Billing" */
  it("grants once, keeps one grant on a repeat, and revokes", async () => {
    addMember({ memory, userId: MEMBER });

    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: true,
      caller: ADMIN,
      actor: ADMIN,
    });
    expect(await service.listMembers({ organizationId: ORG })).toEqual([{ userId: MEMBER }]);

    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: true,
      caller: ADMIN,
      actor: ADMIN,
    });
    expect(memory.grants.filter((row) => row.revokedAt === null)).toHaveLength(1);

    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: false,
      caller: ADMIN,
      actor: ADMIN,
    });
    expect(await service.listMembers({ organizationId: ORG })).toEqual([]);
  });

  /** @scenario "A disabled member is not listed as a Billing holder" */
  it("leaves a disabled member out of the holders", async () => {
    addMember({ memory, userId: MEMBER, disabled: true });
    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: true,
      caller: ADMIN,
      actor: ADMIN,
    });

    expect(await service.listMembers({ organizationId: ORG })).toEqual([]);
  });

  /** @scenario "Granting or revoking Billing never reaches beyond the caller" */
  it("refuses a caller lacking a Billing permission, granting or revoking", async () => {
    addMember({ memory, userId: MEMBER });
    lacking.set(ORG_MANAGER.id, ["subscription:manage", "seatRequests:manage"]);

    await expect(
      service.setRole({
        organizationId: ORG,
        userId: MEMBER,
        holds: true,
        caller: ORG_MANAGER,
        actor: ORG_MANAGER,
      }),
    ).rejects.toThrow(GrantExceedsCallerPermissionsError);
    expect(memory.grants).toHaveLength(0);
    expect(asked[0]).toMatchObject({
      organizationId: ORG,
      caller: ORG_MANAGER,
      scope: { type: "organization", id: ORG },
    });

    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: true,
      caller: ADMIN,
      actor: ADMIN,
    });
    await expect(
      service.setRole({
        organizationId: ORG,
        userId: MEMBER,
        holds: false,
        caller: ORG_MANAGER,
        actor: ORG_MANAGER,
      }),
    ).rejects.toThrow(GrantExceedsCallerPermissionsError);
    expect(await service.listMembers({ organizationId: ORG })).toEqual([{ userId: MEMBER }]);
  });

  /** @scenario "Granting or revoking Billing never reaches beyond the caller" */
  it("refuses an anonymous caller and lets a system write through unasked", async () => {
    addMember({ memory, userId: MEMBER });

    await expect(
      service.setRole({
        organizationId: ORG,
        userId: MEMBER,
        holds: true,
        caller: { type: "anonymous" },
        actor: ADMIN,
      }),
    ).rejects.toThrow(GrantExceedsCallerPermissionsError);

    await service.setRole({
      organizationId: ORG,
      userId: MEMBER,
      holds: true,
      caller: { type: "system" },
      actor: ADMIN,
    });
    expect(asked).toHaveLength(0);
    expect(await service.listMembers({ organizationId: ORG })).toEqual([{ userId: MEMBER }]);
  });
});
