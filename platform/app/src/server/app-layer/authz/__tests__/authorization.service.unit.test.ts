import { AccessNotGrantedError, isSealedAuthorization } from "@langwatch/actor";
import type { AuthzPermission, AuthzScopeRef } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";
import {
  AUTHORIZATION_MAX_AGE_MS,
  AuthorizationService,
} from "../authorization.service";
import type { SharedReadRow } from "../repositories/shared-reads.grants.repository";

/**
 * ADR-144 block B: the proof minted at the door.
 *
 * @see specs/governance/aggregate-project.feature
 */

const NOW = 1_760_000_000_000;
const ORG = "org_acme";
const AGGREGATE = "proj_aggregate";
const ANA = { type: "user", id: "user_ana" } as const;
const ROUTE = { kind: "route", route: "traces.list" } as const;

const aggregateScope: AuthzScopeRef = {
  type: "project",
  id: AGGREGATE,
  teamId: "team_leadership",
  organizationId: ORG,
};

function sharedRow(overrides: Partial<SharedReadRow> = {}): SharedReadRow {
  return {
    grantId: "grant_shared_1",
    memberProjectId: "proj_member_1",
    condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" },
    expiresAt: null,
    ...overrides,
  };
}

function door({
  allowed = true,
  rows = [] as SharedReadRow[],
  scope = aggregateScope as AuthzScopeRef | null,
  permissions = [
    "traces:view",
    "analytics:view",
    "project:view",
  ] as AuthzPermission[],
} = {}) {
  const deps = {
    authz: {
      effectivePermissions: vi
        .fn()
        .mockResolvedValue(
          allowed
            ? permissions
            : permissions.filter((each) => each !== "traces:view"),
        ),
    },
    collector: { resolveScopeRef: vi.fn().mockResolvedValue(scope) },
    sharedReads: { findLiveSharedReads: vi.fn().mockResolvedValue(rows) },
    now: () => NOW,
  };
  return {
    deps,
    service: new AuthorizationService(
      deps as unknown as ConstructorParameters<typeof AuthorizationService>[0],
    ),
  };
}

describe("authorize", () => {
  describe("when an admin opens an aggregate with two members", () => {
    /** @scenario "Opening an aggregate mints one proof listing own and shared grants" */
    it("mints one sealed proof: the own grant in full, one shared grant per member with traces view only", async () => {
      const soon = new Date(NOW + 60_000);
      const { service, deps } = door({
        rows: [
          sharedRow(),
          sharedRow({
            grantId: "grant_shared_2",
            memberProjectId: "proj_member_2",
            condition: {
              type: "trace",
              from: "2026-10-01T00:00:00.000Z",
              until: "2026-12-31T00:00:00.000Z",
            },
            expiresAt: soon,
          }),
        ],
      });

      const proof = await service.authorize({
        actor: ANA,
        principal: ANA,
        permission: "traces:view",
        scope: { projectId: AGGREGATE },
        purpose: ROUTE,
      });

      expect(isSealedAuthorization(proof)).toBe(true);
      expect(proof.scope).toEqual({ organizationId: ORG });
      expect(proof.purpose).toEqual(ROUTE);
      expect(proof.grants).toEqual([
        {
          projectId: AGGREGATE,
          permissions: ["traces:view", "analytics:view", "project:view"],
          via: [],
          kind: "own",
        },
        {
          projectId: "proj_member_1",
          permissions: ["traces:view"],
          via: ["grant_shared_1"],
          kind: "shared",
          condition: {
            type: "trace",
            from: Date.parse("2026-10-01T00:00:00.000Z"),
            until: null,
          },
        },
        {
          projectId: "proj_member_2",
          permissions: ["traces:view"],
          via: ["grant_shared_2"],
          kind: "shared",
          condition: {
            type: "trace",
            from: Date.parse("2026-10-01T00:00:00.000Z"),
            until: Date.parse("2026-12-31T00:00:00.000Z"),
          },
        },
      ]);
      // The earliest expiry among the grants, below the ceiling.
      expect(proof.expiresAt).toBe(soon.getTime());
      expect(deps.sharedReads.findLiveSharedReads).toHaveBeenCalledWith({
        organizationId: ORG,
        readerProjectId: AGGREGATE,
      });
    });

    it("expires at the ceiling when no grant expires sooner", async () => {
      const { service } = door({ rows: [sharedRow()] });
      const proof = await service.authorize({
        actor: ANA,
        principal: ANA,
        permission: "traces:view",
        scope: { projectId: AGGREGATE },
        purpose: ROUTE,
      });
      expect(proof.expiresAt).toBe(NOW + AUTHORIZATION_MAX_AGE_MS);
    });
  });

  describe("when the permission is one the project-reader role never confers", () => {
    it("mints the own grant alone and never asks for shared reads", async () => {
      const { service, deps } = door({
        rows: [sharedRow()],
        permissions: ["traces:view", "traces:update", "project:view"],
      });
      const proof = await service.authorize({
        actor: ANA,
        principal: ANA,
        permission: "traces:update",
        scope: { projectId: AGGREGATE },
        purpose: ROUTE,
      });
      expect(proof.grants.map((grant) => grant.kind)).toEqual(["own"]);
      expect(deps.sharedReads.findLiveSharedReads).not.toHaveBeenCalled();
    });
  });

  describe("when a shared row cannot be applied", () => {
    it("leaves out a non-empty where, an expired grant, and a self reference", async () => {
      const { service } = door({
        rows: [
          sharedRow({
            grantId: "grant_where",
            memberProjectId: "proj_where",
            condition: { type: "trace", where: 'attributes["env"] == "prod"' },
          }),
          sharedRow({
            grantId: "grant_expired",
            memberProjectId: "proj_expired",
            expiresAt: new Date(NOW - 1),
          }),
          sharedRow({ grantId: "grant_self", memberProjectId: AGGREGATE }),
          sharedRow(),
        ],
      });
      const proof = await service.authorize({
        actor: ANA,
        principal: ANA,
        permission: "traces:view",
        scope: { projectId: AGGREGATE },
        purpose: ROUTE,
      });
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([
        AGGREGATE,
        "proj_member_1",
      ]);
    });
  });

  describe("when the door refuses", () => {
    it("refuses a denied permission and an unknown project alike, as not granted", async () => {
      await expect(
        door({ allowed: false }).service.authorize({
          actor: ANA,
          principal: ANA,
          permission: "traces:view",
          scope: { projectId: AGGREGATE },
          purpose: ROUTE,
        }),
      ).rejects.toBeInstanceOf(AccessNotGrantedError);
      await expect(
        door({ scope: null }).service.authorize({
          actor: ANA,
          principal: ANA,
          permission: "traces:view",
          scope: { projectId: "proj_missing" },
          purpose: ROUTE,
        }),
      ).rejects.toBeInstanceOf(AccessNotGrantedError);
    });
  });
});

describe("AuthorizationService.authorizeInternal", () => {
  describe("given platform code reading a project on its own behalf", () => {
    describe("when it asks for a proof", () => {
      it("mints an own-only proof for the one project without evaluating a permission", async () => {
        const { service, deps } = door({ allowed: false, rows: [sharedRow()] });
        const proof = await service.authorizeInternal({
          actor: {
            type: "internal",
            codePath: "trace-processing/traceSummary.store",
          },
          projectId: AGGREGATE,
          permission: "traces:view",
          purpose: { kind: "event", eventId: "evt_1" },
        });
        expect(isSealedAuthorization(proof)).toBe(true);
        expect(proof.principal).toEqual({
          type: "internal",
          codePath: "trace-processing/traceSummary.store",
        });
        expect(proof.scope).toEqual({ organizationId: ORG });
        expect(proof.grants).toEqual([
          {
            projectId: AGGREGATE,
            permissions: ["traces:view"],
            via: [],
            kind: "own",
          },
        ]);
        expect(proof.expiresAt).toBe(NOW + AUTHORIZATION_MAX_AGE_MS);
        expect(deps.authz.effectivePermissions).not.toHaveBeenCalled();
        expect(deps.sharedReads.findLiveSharedReads).not.toHaveBeenCalled();
      });

      it("remembers the project's organisation across mints", async () => {
        const { service, deps } = door();
        const mint = () =>
          service.authorizeInternal({
            actor: { type: "system", name: "aggregateReconciler" },
            projectId: AGGREGATE,
            permission: "traces:view",
            purpose: { kind: "operator", entry: "reconcile" },
          });
        await mint();
        await mint();
        expect(deps.collector.resolveScopeRef).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a project that does not exist", () => {
    describe("when platform code asks for a proof on it", () => {
      it("refuses it as not granted", async () => {
        const { service } = door({ scope: null });
        await expect(
          service.authorizeInternal({
            actor: { type: "internal", codePath: "x" },
            projectId: "proj_missing",
            permission: "traces:view",
            purpose: { kind: "event", eventId: "evt_1" },
          }),
        ).rejects.toBeInstanceOf(AccessNotGrantedError);
      });
    });
  });
});

describe("the shared-read lookup behind each mint", () => {
  const mintFor = (service: AuthorizationService) =>
    service.authorize({
      actor: ANA,
      principal: ANA,
      permission: "traces:view",
      scope: { projectId: AGGREGATE },
      purpose: ROUTE,
    });

  const cachedDoor = ({
    epoch,
    clock = { now: NOW },
    rows = [sharedRow()],
  }: {
    epoch: { value: number | null };
    clock?: { now: number };
    rows?: SharedReadRow[];
  }) => {
    const { deps } = door({ rows });
    const findLiveSharedReads = deps.sharedReads.findLiveSharedReads;
    const service = new AuthorizationService({
      ...(deps as unknown as ConstructorParameters<
        typeof AuthorizationService
      >[0]),
      epochReader: async () => epoch.value,
      cacheEnabled: () => true,
      now: () => clock.now,
    });
    return { service, findLiveSharedReads };
  };

  describe("given the organisation's epoch has not moved", () => {
    describe("when the same aggregate mints twice", () => {
      it("reads the ledger once", async () => {
        const { service, findLiveSharedReads } = cachedDoor({
          epoch: { value: 7 },
        });

        await mintFor(service);
        const second = await mintFor(service);

        expect(findLiveSharedReads).toHaveBeenCalledTimes(1);
        expect(second.grants.map((grant) => grant.projectId)).toEqual([
          AGGREGATE,
          "proj_member_1",
        ]);
      });
    });
  });

  describe("given a member is attached after the first mint", () => {
    describe("when the attach bumps the epoch and the aggregate mints again", () => {
      it("reads the ledger afresh and carries the new member", async () => {
        const epoch = { value: 7 as number | null };
        const { service, findLiveSharedReads } = cachedDoor({ epoch });
        await mintFor(service);

        findLiveSharedReads.mockResolvedValue([
          sharedRow(),
          sharedRow({
            grantId: "grant_shared_2",
            memberProjectId: "proj_member_2",
          }),
        ]);
        epoch.value = 8;
        const proof = await mintFor(service);

        expect(findLiveSharedReads).toHaveBeenCalledTimes(2);
        expect(proof.grants.map((grant) => grant.projectId)).toEqual([
          AGGREGATE,
          "proj_member_1",
          "proj_member_2",
        ]);
      });
    });
  });

  describe("given the epoch never moves", () => {
    describe("when the cached lookup is older than its ceiling", () => {
      it("reads the ledger afresh", async () => {
        const clock = { now: NOW };
        const { service, findLiveSharedReads } = cachedDoor({
          epoch: { value: 7 },
          clock,
        });
        await mintFor(service);

        clock.now = NOW + 30_000;
        await mintFor(service);

        expect(findLiveSharedReads).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given there is no epoch to compare against", () => {
    describe("when the aggregate mints twice", () => {
      it("reads the ledger every time", async () => {
        const { service, findLiveSharedReads } = cachedDoor({
          epoch: { value: null },
        });

        await mintFor(service);
        await mintFor(service);

        expect(findLiveSharedReads).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a cached row whose grant has since expired", () => {
    describe("when the aggregate mints after the expiry", () => {
      it("leaves the expired grant out though the row came from the cache", async () => {
        const clock = { now: NOW };
        const { service } = cachedDoor({
          epoch: { value: 7 },
          clock,
          rows: [sharedRow({ expiresAt: new Date(NOW + 1_000) })],
        });
        await mintFor(service);

        clock.now = NOW + 2_000;
        const proof = await mintFor(service);

        expect(proof.grants.map((grant) => grant.kind)).toEqual(["own"]);
      });
    });
  });
});
