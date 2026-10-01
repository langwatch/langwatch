/**
 * @see specs/rbac/platform-operators.feature
 */
import type { LedgerActor } from "@langwatch/actor";
import { PLATFORM_GRANT_ERASURE_REASON, type PlatformOperator } from "@langwatch/authz-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AuthzPlatformGrantRepository } from "../../repositories/authz-platform-grant.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzUserStandingRepository } from "../../repositories/memory/memory.authz-user-standing.repository.ts";
import {
  AuthzPlatformOperatorsService,
  type PlatformGrantLedger,
} from "../authz-platform-operators.service.ts";

const ALICE = "user_alice";
const BOB = "user_bob";
const CAROL = "user_carol";
const ACTOR: LedgerActor = { type: "user", id: ALICE };
const SYSTEM_ACTOR: LedgerActor = { type: "system", id: null };

class PlatformGrantsInMemory extends AuthzPlatformGrantRepository {
  rows: PlatformOperator[] = [];

  async findGrants({
    grantId,
    userId,
  }: {
    grantId?: string;
    userId?: string;
  }): Promise<PlatformOperator[]> {
    return this.rows.filter(
      (row) =>
        (grantId === undefined || row.grantId === grantId) &&
        (userId === undefined || row.userId === userId),
    );
  }
}

class RecordingLedger implements PlatformGrantLedger {
  attached: { grantId: string; userId: string }[] = [];
  revoked: { grantIds: string[]; reason?: string }[] = [];

  async attachPlatformGrant(args: { grantId: string; userId: string }): Promise<void> {
    this.attached.push({ grantId: args.grantId, userId: args.userId });
  }

  async revokePlatformGrants(args: { grantIds: string[]; reason?: string }): Promise<void> {
    this.revoked.push({ grantIds: args.grantIds, ...(args.reason ? { reason: args.reason } : {}) });
  }
}

function setup({
  holders = [] as string[],
  deactivated = [] as string[],
}: { holders?: string[]; deactivated?: string[] } = {}) {
  const grants = new PlatformGrantsInMemory();
  const memory = AuthzMemoryStore.create();
  for (const userId of deactivated) {
    memory.userStandings.set(userId, { deactivated: true, erased: false, changedAtMs: 1 });
  }
  const standings = MemoryAuthzUserStandingRepository.create({ memory });
  grants.rows = holders.map((userId) => ({
    grantId: `grant_${userId}`,
    userId,
    grantedAt: Temporal.Instant.fromEpochMilliseconds(0),
  }));
  const ledger = new RecordingLedger();
  const service = AuthzPlatformOperatorsService.create({
    grants,
    standings,
    ledger,
    newGrantId: () => "grant_new",
  });

  return { service, ledger, grants, standings };
}

describe("AuthzPlatformOperatorsService", () => {
  describe("given a user holding the platform-operator grant", () => {
    /** @scenario A platform operator holds ops permissions at the platform */
    it("answers ops:view and ops:manage at the platform", async () => {
      const { service } = setup({ holders: [ALICE] });
      const principal = { type: "user" as const, id: ALICE };

      await expect(service.can({ principal, permission: "ops:view" })).resolves.toBe(true);
      await expect(service.can({ principal, permission: "ops:manage" })).resolves.toBe(true);
    });

    /** @scenario The platform grant confers nothing but ops permissions */
    it("answers no permission outside the role", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.can({ principal: { type: "user", id: ALICE }, permission: "project:view" }),
      ).resolves.toBe(false);
    });
  });

  describe("given one of two holders is deactivated in authz's standing table", () => {
    /** @scenario A deactivated user's platform grant confers nothing */
    it("answers nothing for them, for `can` and for the holder list alike", async () => {
      const { service } = setup({ holders: [ALICE, BOB], deactivated: [BOB] });

      await expect(
        service.can({ principal: { type: "user", id: BOB }, permission: "ops:view" }),
      ).resolves.toBe(false);
      await expect(service.list()).resolves.toEqual([expect.objectContaining({ userId: ALICE })]);
    });
  });

  describe("given a user with no platform grant", () => {
    /** @scenario A user without the platform grant holds nothing at the platform */
    it("answers no ops permission", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.can({ principal: { type: "user", id: BOB }, permission: "ops:view" }),
      ).resolves.toBe(false);
    });
  });

  describe("given an API key or an anonymous caller", () => {
    /** @scenario Only users are asked at the platform */
    it("answers no ops permission", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.can({ principal: { type: "apiKey", id: ALICE }, permission: "ops:view" }),
      ).resolves.toBe(false);
      await expect(
        service.can({ principal: { type: "anonymous" }, permission: "ops:view" }),
      ).resolves.toBe(false);
    });
  });

  describe("when a platform operator grants the role to another user", () => {
    /** @scenario A platform operator grants the role to another user */
    it("writes one platform grant for that user", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      const granted = await service.grant({
        principal: { type: "user", id: BOB },
        caller: { type: "user", id: ALICE },
        actor: ACTOR,
      });

      expect(granted).toMatchObject({ grantId: "grant_new", userId: BOB });
      expect(ledger.attached).toEqual([{ grantId: "grant_new", userId: BOB }]);
    });

    /** @scenario Granting the role to a current holder writes nothing */
    it("keeps the grant a holder already has", async () => {
      const { service, ledger } = setup({ holders: [ALICE, BOB] });

      const granted = await service.grant({
        principal: { type: "user", id: BOB },
        caller: { type: "user", id: ALICE },
        actor: ACTOR,
      });

      expect(granted.grantId).toBe(`grant_${BOB}`);
      expect(ledger.attached).toEqual([]);
    });
  });

  describe("when the role is granted to a deactivated holder", () => {
    /** @scenario Granting the role to a current holder writes nothing */
    it("keeps the grant they hold and writes nothing", async () => {
      const { service, ledger } = setup({ holders: [ALICE, BOB], deactivated: [BOB] });

      const granted = await service.grant({
        principal: { type: "user", id: BOB },
        caller: { type: "user", id: ALICE },
        actor: ACTOR,
      });

      expect(granted.grantId).toBe(`grant_${BOB}`);
      expect(ledger.attached).toEqual([]);
    });
  });

  describe("when someone grants the role to themselves", () => {
    /** @scenario Nobody grants the platform-operator role to themselves */
    it("is refused with platform_operator_self_grant", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await expect(
        service.grant({
          principal: { type: "user", id: BOB },
          caller: { type: "user", id: BOB },
          actor: { type: "user", id: BOB },
        }),
      ).rejects.toMatchObject({ code: "platform_operator_self_grant", meta: { userId: BOB } });
      expect(ledger.attached).toEqual([]);
    });
  });

  describe("when a user without ops:manage grants the role", () => {
    /** @scenario Only a holder of ops:manage grants or revokes the role */
    it("is refused with grant_exceeds_caller_permissions naming ops:manage", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await expect(
        service.grant({
          principal: { type: "user", id: CAROL },
          caller: { type: "user", id: BOB },
          actor: { type: "user", id: BOB },
        }),
      ).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
        meta: { missingPermissions: ["ops:manage"] },
      });
      expect(ledger.attached).toEqual([]);
    });

    /** @scenario Only a holder of ops:manage grants or revokes the role */
    it("refuses an API key the same way", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.grant({
          principal: { type: "user", id: CAROL },
          caller: { type: "apiKey", id: "key_1" },
          actor: SYSTEM_ACTOR,
        }),
      ).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
        meta: { missingPermissions: ["ops:manage"] },
      });
    });
  });

  describe("when the role is granted to a group, team, organization or API key", () => {
    /** @scenario The platform-operator role is granted to users only */
    it.each(["group", "team", "organization", "apiKey"] as const)(
      "refuses a %s principal with grant_validation_failed",
      async (principalType) => {
        const { service, ledger } = setup({ holders: [ALICE] });

        await expect(
          service.grant({
            principal: { type: principalType, id: "principal_1" },
            caller: { type: "user", id: ALICE },
            actor: ACTOR,
          }),
        ).rejects.toMatchObject({ code: "grant_validation_failed", meta: { principalType } });
        expect(ledger.attached).toEqual([]);
      },
    );
  });

  describe("when the system seeds the first operator", () => {
    /** @scenario The system grants the role without a holder */
    it("writes the grant under the id it was given", async () => {
      const { service, ledger } = setup();

      await service.grant({
        principal: { type: "user", id: ALICE },
        caller: { type: "system" },
        actor: SYSTEM_ACTOR,
        source: "migration",
        grantId: "grant_seeded",
      });

      expect(ledger.attached).toEqual([{ grantId: "grant_seeded", userId: ALICE }]);
    });
  });

  describe("when an operator revokes another holder's grant", () => {
    /** @scenario A platform operator revokes another holder */
    it("revokes that grant", async () => {
      const { service, ledger } = setup({ holders: [ALICE, BOB] });

      await service.revoke({
        grantId: `grant_${BOB}`,
        caller: { type: "user", id: ALICE },
        actor: ACTOR,
      });

      expect(ledger.revoked).toEqual([{ grantIds: [`grant_${BOB}`] }]);
    });
  });

  describe("when the revoke would leave no platform operator", () => {
    /** @scenario The last platform operator cannot be revoked */
    it("is refused with platform_operator_last_holder", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await expect(
        service.revoke({
          grantId: `grant_${ALICE}`,
          caller: { type: "user", id: ALICE },
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({
        code: "platform_operator_last_holder",
        meta: { grantId: `grant_${ALICE}`, userId: ALICE },
      });
      expect(ledger.revoked).toEqual([]);
    });

    /** @scenario The last platform operator cannot be revoked */
    it("refuses the system too when the revoke is not an erasure", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.revoke({
          grantId: `grant_${ALICE}`,
          caller: { type: "system" },
          actor: SYSTEM_ACTOR,
        }),
      ).rejects.toMatchObject({ code: "platform_operator_last_holder" });
    });

    /** @scenario Erasing the last platform operator revokes their grant */
    it("lets user erasure revoke a holder who is no longer active", async () => {
      const { service, ledger } = setup({ holders: [ALICE], deactivated: [ALICE] });

      await service.revoke({
        grantId: `grant_${ALICE}`,
        caller: { type: "system" },
        actor: SYSTEM_ACTOR,
        reason: PLATFORM_GRANT_ERASURE_REASON,
      });

      expect(ledger.revoked).toEqual([
        { grantIds: [`grant_${ALICE}`], reason: PLATFORM_GRANT_ERASURE_REASON },
      ]);
    });

    /** @scenario Erasing the last platform operator revokes their grant */
    it("does not honour the erasure reason while the holder is still active", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await expect(
        service.revoke({
          grantId: `grant_${ALICE}`,
          caller: { type: "system" },
          actor: SYSTEM_ACTOR,
          reason: PLATFORM_GRANT_ERASURE_REASON,
        }),
      ).rejects.toMatchObject({ code: "platform_operator_last_holder" });
      expect(ledger.revoked).toEqual([]);
    });

    /** @scenario Erasing the last platform operator revokes their grant */
    it("does not let a person claim the erasure override", async () => {
      const { service } = setup({ holders: [ALICE] });

      await expect(
        service.revoke({
          grantId: `grant_${ALICE}`,
          caller: { type: "user", id: ALICE },
          actor: ACTOR,
          reason: PLATFORM_GRANT_ERASURE_REASON,
        }),
      ).rejects.toMatchObject({ code: "platform_operator_last_holder" });
    });
  });

  describe("when the grant is not a live platform grant", () => {
    /** @scenario A platform operator revokes another holder */
    it("is refused with grant_not_found", async () => {
      const { service } = setup({ holders: [ALICE, BOB] });

      await expect(
        service.revoke({
          grantId: "grant_other",
          caller: { type: "user", id: ALICE },
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "grant_not_found", meta: { grantId: "grant_other" } });
    });
  });

  describe("when an erased user's grants are revoked", () => {
    /** @scenario Erasure revokes the erased person's platform grant */
    it("revokes every grant they hold through the erasure path, even the last", async () => {
      const { service, ledger, standings } = setup({ holders: [ALICE] });
      await standings.recordErased({
        userId: ALICE,
        at: Temporal.Instant.fromEpochMilliseconds(5),
      });

      await service.revokeErased({ userId: ALICE });

      expect(ledger.revoked).toEqual([
        { grantIds: [`grant_${ALICE}`], reason: PLATFORM_GRANT_ERASURE_REASON },
      ]);
    });

    /** @scenario Erasure revokes the erased person's platform grant */
    it("refuses while the standing table still holds the last holder as active", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await expect(service.revokeErased({ userId: ALICE })).rejects.toMatchObject({
        code: "platform_operator_last_holder",
      });
      expect(ledger.revoked).toEqual([]);
    });

    /** @scenario A redelivered user fact changes nothing */
    it("revokes nothing for a user holding no grant", async () => {
      const { service, ledger } = setup({ holders: [ALICE] });

      await service.revokeErased({ userId: BOB });

      expect(ledger.revoked).toEqual([]);
    });
  });
});
