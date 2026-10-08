/**
 * ADR-175 block B: the proof minted at the door.
 * @see specs/governance/aggregate-project.feature
 */
import { type AuthzPermission, isSealedAuthorization } from "@langwatch/authorization";
import { AuthzScopeNotFoundError, type AuthzScopeRef } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { AuthzEpochRepository } from "../../repositories/authz-epoch.repository.ts";
import type {
  AuthzSharedReadRepository,
  SharedReadRow,
} from "../../repositories/authz-shared-read.repository.ts";
import {
  AUTHORIZATION_MAX_AGE_MS,
  AuthorizationService,
  INTERNAL_SCOPE_CACHE_MAX_ENTRIES,
} from "../authorization.service.ts";
import type { AuthzService } from "../authz.service.ts";

const NOW = 1_760_000_000_000;
const ORG = "org_acme";
const AGGREGATE = "proj_aggregate";
const ANA = { type: "user", id: "user_ana" } as const;
const ROUTE = { kind: "route", route: "traces.list" } as const;
const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

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

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

/** The minter over doubles of the decision service and the shared-read rows it reads. */
function door({
  allowed = true,
  rows = [] as SharedReadRow[],
  scope = aggregateScope as AuthzScopeRef | null,
  permissions = ["traces:view", "analytics:view", "project:view"] as AuthzPermission[],
  epoch,
  clock = { now: NOW },
}: {
  allowed?: boolean;
  rows?: SharedReadRow[];
  scope?: AuthzScopeRef | null;
  permissions?: AuthzPermission[];
  epoch?: { value: number | null };
  clock?: { now: number };
} = {}) {
  const effectivePermissions = vi
    .fn<AuthzService["effectivePermissions"]>()
    .mockResolvedValue(
      allowed ? permissions : permissions.filter((each) => each !== "traces:view"),
    );
  const getScope = vi.fn<AuthzService["getScope"]>(async (ids) => {
    if (scope === null) throw new AuthzScopeNotFoundError(ids);
    return { ...scope, id: ids.projectId ?? scope.id } as AuthzScopeRef;
  });
  const findLiveSharedReads = vi
    .fn<AuthzSharedReadRepository["findLiveSharedReads"]>()
    .mockResolvedValue(rows);
  const findEpoch = vi
    .fn<AuthzEpochRepository["findEpoch"]>()
    .mockImplementation(async () => epoch?.value ?? null);
  const service = AuthorizationService.create({
    permissions: { effectivePermissions, getScope },
    sharedReads: { findLiveSharedReads },
    ...(epoch ? { epoch: { findEpoch }, cacheEnabled: () => true } : {}),
    now: () => clock.now,
  });
  return { service, effectivePermissions, getScope, findLiveSharedReads };
}

const mintFor = (service: AuthorizationService) =>
  service.authorize({
    actor: ANA,
    principal: ANA,
    permission: "traces:view",
    scope: { projectId: AGGREGATE },
    purpose: ROUTE,
  });

describe("authorize", () => {
  describe("when an admin opens an aggregate with two members", () => {
    /** @scenario "Opening an aggregate mints one proof listing own and shared grants" */
    it("mints one sealed proof: the own grant in full, one shared grant per member with traces view only", async () => {
      const soon = NOW + 60_000;
      const { service, findLiveSharedReads } = door({
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
            expiresAt: at(soon),
          }),
        ],
      });

      const proof = await mintFor(service);

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
            from: Temporal.Instant.from("2026-10-01T00:00:00.000Z").epochMilliseconds,
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
            from: Temporal.Instant.from("2026-10-01T00:00:00.000Z").epochMilliseconds,
            until: Temporal.Instant.from("2026-12-31T00:00:00.000Z").epochMilliseconds,
          },
        },
      ]);
      // The earliest expiry among the grants, below the ceiling.
      expect(proof.expiresAt).toBe(soon);
      expect(findLiveSharedReads).toHaveBeenCalledWith({
        organizationId: ORG,
        readerProjectId: AGGREGATE,
      });
    });

    it("expires at the ceiling when no grant expires sooner", async () => {
      const { service } = door({ rows: [sharedRow()] });
      const proof = await mintFor(service);
      expect(proof.expiresAt).toBe(NOW + AUTHORIZATION_MAX_AGE_MS);
    });
  });

  describe("when the permission is one the project-reader role never confers", () => {
    it("mints the own grant alone and never asks for shared reads", async () => {
      const { service, findLiveSharedReads } = door({
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
      expect(findLiveSharedReads).not.toHaveBeenCalled();
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
            expiresAt: at(NOW - 1),
          }),
          sharedRow({ grantId: "grant_self", memberProjectId: AGGREGATE }),
          sharedRow(),
        ],
      });
      const proof = await mintFor(service);
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([AGGREGATE, "proj_member_1"]);
    });

    it("leaves out a stored window with no start rather than opening it from the epoch", async () => {
      const { service } = door({
        rows: [
          sharedRow({
            grantId: "grant_no_start",
            memberProjectId: "proj_no_start",
            condition: { type: "trace" },
          }),
          sharedRow(),
        ],
      });
      const proof = await mintFor(service);
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([AGGREGATE, "proj_member_1"]);
    });
  });

  describe("when the door refuses", () => {
    it("refuses a denied permission and an unknown project alike, as not granted", async () => {
      await expect(codeOf(() => mintFor(door({ allowed: false }).service))).resolves.toBe(
        "access_not_granted",
      );
      await expect(
        codeOf(() =>
          door({ scope: null }).service.authorize({
            actor: ANA,
            principal: ANA,
            permission: "traces:view",
            scope: { projectId: "proj_missing" },
            purpose: ROUTE,
          }),
        ),
      ).resolves.toBe("access_not_granted");
    });
  });
});

describe("AuthorizationService.authorizeInternal", () => {
  describe("given platform code reading a project on its own behalf", () => {
    describe("when it asks for a proof", () => {
      it("mints an own-only proof for the one project without evaluating a permission", async () => {
        const { service, effectivePermissions, findLiveSharedReads } = door({
          allowed: false,
          rows: [sharedRow()],
        });
        const proof = await service.authorizeInternal({
          actor: { type: "internal", codePath: "trace-processing/traceSummary.store" },
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
          { projectId: AGGREGATE, permissions: ["traces:view"], via: [], kind: "own" },
        ]);
        expect(proof.expiresAt).toBe(NOW + AUTHORIZATION_MAX_AGE_MS);
        expect(effectivePermissions).not.toHaveBeenCalled();
        expect(findLiveSharedReads).not.toHaveBeenCalled();
      });

      it("remembers the project's organisation across mints", async () => {
        const { service, getScope } = door();
        const mint = () =>
          service.authorizeInternal({
            actor: { type: "system", name: "aggregateReconciler" },
            projectId: AGGREGATE,
            permission: "traces:view",
            purpose: { kind: "operator", entry: "reconcile" },
          });
        await mint();
        await mint();
        expect(getScope).toHaveBeenCalledTimes(1);
      });
    });

    describe("when it mints for more projects than the cache holds", () => {
      it("keeps the newest projects and forgets the oldest first", async () => {
        const { service, getScope } = door();
        const mint = (projectId: string) =>
          service.authorizeInternal({
            actor: { type: "system", name: "aggregateReconciler" },
            projectId,
            permission: "traces:view",
            purpose: { kind: "operator", entry: "reconcile" },
          });
        const projects = Array.from(
          { length: INTERNAL_SCOPE_CACHE_MAX_ENTRIES + 1 },
          (_, index) => `proj_${index}`,
        );
        expect(projects.length).toBeGreaterThan(1);
        for (const projectId of projects) await mint(projectId);
        expect(getScope).toHaveBeenCalledTimes(projects.length);

        for (const projectId of projects.slice(1)) await mint(projectId);
        expect(getScope).toHaveBeenCalledTimes(projects.length);

        await mint("proj_0");
        expect(getScope).toHaveBeenCalledTimes(projects.length + 1);
      });
    });
  });

  describe("given a project that does not exist", () => {
    describe("when platform code asks for a proof on it", () => {
      it("refuses it as not granted", async () => {
        const { service } = door({ scope: null });
        await expect(
          codeOf(() =>
            service.authorizeInternal({
              actor: { type: "internal", codePath: "x" },
              projectId: "proj_missing",
              permission: "traces:view",
              purpose: { kind: "event", eventId: "evt_1" },
            }),
          ),
        ).resolves.toBe("access_not_granted");
      });
    });
  });
});

describe("the shared-read lookup behind each mint", () => {
  describe("given the organisation's epoch has not moved", () => {
    describe("when the same aggregate mints twice", () => {
      it("reads the ledger once", async () => {
        const { service, findLiveSharedReads } = door({
          rows: [sharedRow()],
          epoch: { value: 7 },
        });

        await mintFor(service);
        const second = await mintFor(service);

        expect(findLiveSharedReads).toHaveBeenCalledTimes(1);
        expect(second.grants.map((grant) => grant.projectId)).toEqual([AGGREGATE, "proj_member_1"]);
      });
    });
  });

  describe("given a member is attached after the first mint", () => {
    describe("when the attach bumps the epoch and the aggregate mints again", () => {
      it("reads the ledger afresh and carries the new member", async () => {
        const epoch = { value: 7 as number | null };
        const { service, findLiveSharedReads } = door({ rows: [sharedRow()], epoch });
        await mintFor(service);

        findLiveSharedReads.mockResolvedValue([
          sharedRow(),
          sharedRow({ grantId: "grant_shared_2", memberProjectId: "proj_member_2" }),
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
        const { service, findLiveSharedReads } = door({
          rows: [sharedRow()],
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
        const { service, findLiveSharedReads } = door({
          rows: [sharedRow()],
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
        const { service } = door({
          rows: [sharedRow({ expiresAt: at(NOW + 1_000) })],
          epoch: { value: 7 },
          clock,
        });
        await mintFor(service);

        clock.now = NOW + 2_000;
        const proof = await mintFor(service);

        expect(proof.grants.map((grant) => grant.kind)).toEqual(["own"]);
      });
    });
  });
});
