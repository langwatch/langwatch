/**
 * ADR-185 §1-§2 and §8: braid writes over in-test twins of the ledger, its reads and the lock.
 * @see modules/authz/specs/braids.feature
 */
import type { GrantCondition, LedgerActor } from "@langwatch/authorization";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { LedgerBraidRow } from "../../repositories/authz-ledger-read.repository.ts";
import { MemoryAuthzBraidLockRepository } from "../../repositories/memory/memory.authz-braid-lock.repository.ts";
import { RedisAuthzEpochRepository } from "../../repositories/redis/redis.authz-epoch.repository.ts";
import { AuthzBraidService } from "../authz-braid.service.ts";

const ORG = "org_acme";
const OWNER = "proj_specialists";
const READER = "proj_orchestrator";
const ANA: LedgerActor = { type: "user", id: "user_ana" };
const CALLER = { type: "user", id: "user_ana" } as const;
const FROM_MS = Date.UTC(2026, 9, 1);
const KINDS: Record<string, { organizationId: string; kind: string }> = {
  [OWNER]: { organizationId: ORG, kind: "application" },
  [READER]: { organizationId: ORG, kind: "application" },
  proj_frontdesk: { organizationId: ORG, kind: "application" },
  proj_elsewhere: { organizationId: "org_other", kind: "application" },
  proj_aggregate: { organizationId: ORG, kind: "aggregate" },
  proj_governance: { organizationId: ORG, kind: "internal_governance" },
};

type Row = LedgerBraidRow & { revokedReason: string | null };

function setup({ beyondCaller = [] as string[], failRevokeOnce = false } = {}) {
  const rows: Row[] = [];
  let ids = 0;
  let revokeFailures = failRevokeOnce ? 1 : 0;
  const epoch = { bump: vi.fn(async () => {}) };
  const ledger = {
    attachBraidGrant: vi.fn(
      async (input: {
        readerProjectId: string;
        ownerProjectId: string;
        condition: GrantCondition;
        expiresAtMs?: number;
        replacesGrantId?: string;
      }) => {
        const grantId = `grant_${++ids}`;
        rows.push({
          grantId,
          ownerProjectId: input.ownerProjectId,
          readerProjectId: input.readerProjectId,
          condition: input.condition,
          expiresAt: input.expiresAtMs ? fromDate(new Date(input.expiresAtMs)) : null,
          createdByUserId: "user_ana",
          occurredAt: fromDate(new Date(FROM_MS)),
          revokedReason: null,
          isLive: true,
          replacesGrantId: input.replacesGrantId ?? null,
        });
        return { grantId };
      },
    ),
    revokeBindings: vi.fn(
      async ({ bindingIds, reason }: { bindingIds: string[]; reason?: string }) => {
        if (revokeFailures-- > 0) throw new Error("revoke failed");
        for (const row of rows) {
          if (bindingIds.includes(row.grantId))
            Object.assign(row, { isLive: false, revokedReason: reason ?? null });
        }
      },
    ),
  };
  const service = AuthzBraidService.create({
    ledger,
    reads: {
      findBraids: async ({ projectId, grantId, includeRevoked }) =>
        rows.filter(
          (row) =>
            (includeRevoked || row.isLive) &&
            (grantId === undefined || row.grantId === grantId) &&
            (projectId === undefined ||
              row.ownerProjectId === projectId ||
              row.readerProjectId === projectId),
        ),
    },
    lineage: {
      findProjectLineage: async ({ projectId }) => {
        const project = KINDS[projectId];
        return project ? { teamId: `team_${projectId}`, ...project } : null;
      },
    },
    locks: MemoryAuthzBraidLockRepository.create(),
    epoch,
    permissions: { findPermissionsBeyondCaller: async () => beyondCaller as never },
  });
  const create = (overrides: Record<string, unknown> = {}) =>
    service.createBraid({
      projectId: OWNER,
      readerProjectId: READER,
      fromMs: FROM_MS,
      actor: ANA,
      caller: CALLER,
      ...overrides,
    });
  return { service, rows, ledger, epoch, create };
}

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (error: { code?: string }) => error.code,
  );
}

describe("AuthzBraidService", () => {
  describe("when creating a braid", () => {
    it("attaches a span grant carrying the condition as written and compiled", async () => {
      const { create, ledger } = setup();

      await create({ where: 'attributes["orchestrator"] == "web"' });

      const [input] = ledger.attachBraidGrant.mock.calls[0] ?? [];
      expect(input?.condition).toMatchObject({
        type: "span",
        where: 'attributes["orchestrator"] == "web"',
      });
      expect(input?.condition.compiledWhere?.version).toBe(1);
    });

    /** @scenario "A braid joins two plain projects of one organisation" */
    it.each([
      [OWNER, OWNER, "braid_into_itself"],
      [OWNER, "proj_elsewhere", "braid_across_organizations"],
      ["proj_aggregate", READER, "braid_aggregate_project"],
      [OWNER, "proj_aggregate", "braid_aggregate_project"],
      ["proj_governance", READER, "braid_governance_project"],
    ])("refuses braiding %s into %s with %s", async (owner, reader, code) => {
      const { create, ledger } = setup();

      expect(await refusalOf(create({ projectId: owner, readerProjectId: reader }))).toBe(code);
      expect(ledger.attachBraidGrant).not.toHaveBeenCalled();
    });

    /** @scenario "Several braids may join one pair of projects" */
    it("keeps several braids with different conditions on one pair", async () => {
      const { create, rows } = setup();

      await create({ where: 'attributes["orchestrator"] == "web"' });
      await create({ where: 'name == "payments_agent"' });

      expect(rows.filter((row) => row.isLive)).toHaveLength(2);
    });

    /** @scenario "A braid identical to a live one on the same pair is refused" */
    it("refuses a braid identical to a live one and leaves the live one unchanged", async () => {
      const { create, rows } = setup();
      await create({ where: 'name == "a"' });

      expect(await refusalOf(create({ where: 'name   ==  "a"' }))).toBe("braid_already_exists");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isLive).toBe(true);
    });

    it("lets one of two identical braids asked for at once through", async () => {
      const { create, rows } = setup();

      const codes = await Promise.all([refusalOf(create()), refusalOf(create())]);

      expect(new Set(codes)).toEqual(new Set(["braid_already_exists", undefined]));
      expect(rows).toHaveLength(1);
    });

    /** @scenario "Nobody braids spans they could not read themselves" */
    it("refuses a caller who cannot read the owner's traces", async () => {
      const { create, ledger } = setup({ beyondCaller: ["traces:view"] });

      expect(await refusalOf(create())).toBe("grant_exceeds_caller_permissions");
      expect(ledger.attachBraidGrant).not.toHaveBeenCalled();
    });

    /** @scenario "A reader's distinct conditions fit in one statement" */
    it("refuses a new distinct condition past the reader's limit and accepts a held one", async () => {
      const { create } = setup();
      for (let index = 0; index < 50; index++) await create({ where: `name == "n${index}"` });

      expect(await refusalOf(create({ where: 'name == "one more"' }))).toBe(
        "braid_condition_limit_reached",
      );
      expect(
        await refusalOf(create({ where: 'name == "n0"', expiresAtMs: Date.now() + 60_000 })),
      ).toBeUndefined();
    });
  });

  describe("when changing a braid", () => {
    /** @scenario "A change that is not valid writes nothing" */
    it("refuses an unsupported condition before anything is written", async () => {
      const { create, service, ledger, rows } = setup();
      const braid = await create();

      const code = await refusalOf(
        service.changeBraid({
          projectId: OWNER,
          readerProjectId: READER,
          braidId: braid.braidId,
          where: 'not name == "x"',
          fromMs: FROM_MS,
          actor: ANA,
          caller: CALLER,
        }),
      );

      expect(code).toBe("braid_condition_unsupported");
      expect(ledger.attachBraidGrant).toHaveBeenCalledTimes(1);
      expect(rows[0]?.isLive).toBe(true);
    });

    it("attaches the new grant naming the old, revokes the old, and refuses a stale second change", async () => {
      const { create, service, ledger, rows } = setup();
      const braid = await create();
      const change = (where: string) =>
        service.changeBraid({
          projectId: OWNER,
          readerProjectId: READER,
          braidId: braid.braidId,
          where,
          fromMs: FROM_MS,
          actor: ANA,
          caller: CALLER,
        });

      const codes = await Promise.all([
        refusalOf(change('name == "a"')),
        refusalOf(change('name == "b"')),
      ]);

      expect(new Set(codes)).toEqual(new Set(["braid_changed", undefined]));
      expect(ledger.attachBraidGrant.mock.calls[1]?.[0]).toMatchObject({
        replacesGrantId: braid.braidId,
      });
      expect(rows.filter((row) => row.isLive)).toHaveLength(1);
      expect(rows).toHaveLength(2);
    });

    it("finishes a change whose revoke failed when repeated, without attaching a third grant", async () => {
      const { create, service, rows } = setup({ failRevokeOnce: true });
      const braid = await create();
      const change = () =>
        service.changeBraid({
          projectId: OWNER,
          readerProjectId: READER,
          braidId: braid.braidId,
          where: 'name == "a"',
          fromMs: FROM_MS,
          actor: ANA,
          caller: CALLER,
        });

      await expect(change()).rejects.toThrow("revoke failed");
      await change();

      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.grantId === braid.braidId)?.isLive).toBe(false);
    });

    describe("when another live braid already has the new terms", () => {
      /** @scenario "A change that would make a braid identical to another live braid is refused" */
      it("refuses with braid_already_exists and leaves both braids live as they were", async () => {
        const { create, service, ledger, rows } = setup();
        const kept = await create({ where: 'name == "a"' });
        const changing = await create({ where: 'name == "b"' });

        const code = await refusalOf(
          service.changeBraid({
            projectId: OWNER,
            readerProjectId: READER,
            braidId: changing.braidId,
            where: 'name == "a"',
            fromMs: FROM_MS,
            actor: ANA,
            caller: CALLER,
          }),
        );

        expect(code).toBe("braid_already_exists");
        expect(ledger.attachBraidGrant).toHaveBeenCalledTimes(2);
        expect(ledger.revokeBindings).not.toHaveBeenCalled();
        expect(rows.map((row) => [row.grantId, row.isLive])).toEqual([
          [kept.braidId, true],
          [changing.braidId, true],
        ]);
      });
    });
  });

  describe("when removing a braid", () => {
    /** @scenario "A braid cannot be removed from a project it does not touch" */
    it("refuses a project the braid does not touch and leaves it live", async () => {
      const { create, service, rows } = setup();
      const braid = await create();

      const code = await refusalOf(
        service.removeBraid({
          projectId: "proj_frontdesk",
          braidId: braid.braidId,
          actor: ANA,
          caller: CALLER,
        }),
      );

      expect(code).toBe("braid_not_on_project");
      expect(rows[0]?.isLive).toBe(true);
    });

    it("revokes from the reader's side with reason braid_removed, and a repeat moves the epoch again", async () => {
      const { create, service, rows, epoch } = setup();
      const braid = await create();
      const remove = () =>
        service.removeBraid({
          projectId: READER,
          braidId: braid.braidId,
          actor: ANA,
          caller: CALLER,
        });

      await remove();
      await remove();

      expect(rows[0]).toMatchObject({ isLive: false, revokedReason: "braid_removed" });
      expect(epoch.bump).toHaveBeenCalledTimes(1);
    });
  });

  describe("when listing braids", () => {
    it("lists a braid into other projects on the owner and from other projects on the reader", async () => {
      const { create, service } = setup();
      await create();

      expect((await service.listBraids({ projectId: OWNER })).intoOtherProjects).toHaveLength(1);
      expect((await service.listBraids({ projectId: READER })).fromOtherProjects).toHaveLength(1);
    });
  });
});

describe("RedisAuthzEpochRepository", () => {
  describe("when the bump fails", () => {
    /** @scenario "A revoke that cannot move the organization's epoch reports failure" */
    it("reports authz_epoch_bump_failed rather than swallowing it", async () => {
      const epoch = RedisAuthzEpochRepository.create({
        redis: {
          get: async () => null,
          incr: async () => Promise.reject(new Error("down")),
        } as never,
      });

      expect(await refusalOf(epoch.bump({ organizationId: ORG }))).toBe("authz_epoch_bump_failed");
    });
  });
});
