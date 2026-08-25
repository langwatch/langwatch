/**
 * @see specs/rbac/expiring-grants.feature
 *
 * A grant may carry the date it ends. Nothing runs when that date passes:
 * the row is untouched, no revocation is recorded, and no epoch is bumped.
 * COLLECT is where the rule lives — an elapsed binding is treated as absent
 * — and the write surface refuses a date that is already behind us, so the
 * two halves can never disagree about the boundary.
 */
import type { CollectedBinding } from "@langwatch/authz";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import {
  type AuthzGrantsRepository,
  DuplicateBindingError,
} from "../authz-grants.repository";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";
import { GrantsService } from "../grants.service";
import { makeReader } from "./support/authz-read.stub";

const ORG = "org-1";
const TEAM = "team-1";
/** The one permission an ordinary member never holds, so a binding is the
 *  only thing that can be answering. */
const MANAGE = "organization:manage";

const alice = { type: "user", id: "alice" } as const;
const dana = { type: "user", id: "dana" } as const;
const orgScope = { type: "organization", id: ORG } as const;
const teamScope = { type: "team", id: TEAM, organizationId: ORG } as const;
const memberRole = { builtin: "MEMBER" } as const;

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** An organization-scoped ADMIN binding — the one that carries
 *  organization:manage. */
const adminBinding = (expiresAt: Date | null): CollectedBinding => ({
  role: "ADMIN",
  customRoleId: null,
  scopeType: "ORGANIZATION",
  scopeId: ORG,
  viaGroupId: null,
  expiresAt,
});

/**
 * A member of the organization holding whatever bindings the test hands
 * over, checked through a service whose clock the test owns. No cache: the
 * caching scenarios build their own, so the uncached ones read the storage
 * answer directly.
 */
function makeAuthz({
  bindings,
  now,
}: {
  bindings: CollectedBinding[];
  now: () => number;
}) {
  const reader: AuthzReadRepository = makeReader({
    findOrganizationMembership: vi
      .fn()
      .mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue(bindings),
  });
  const collector = new AuthzCollectorService(reader, {
    now: () => new Date(now()),
  });
  return { reader, authz: new AuthzService(collector) };
}

/**
 * The same member, but through a service cached the way the app caches: an
 * epoch that never moves — because nothing bumps it when a grant ends, which
 * is exactly what these scenarios are about.
 *
 * Both clocks are the ambient one, because they have to move together: the
 * cache measures an entry's age off Date.now() and cannot be handed a clock,
 * so the collector's liveness comparison reads the same source and the test
 * moves them with fake timers.
 */
function makeCachedAuthz(bindings: CollectedBinding[]) {
  const reader: AuthzReadRepository = makeReader({
    findOrganizationMembership: vi
      .fn()
      .mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue(bindings),
  });
  const collector = new AuthzCollectorService(reader, {
    now: () => new Date(),
  });
  return new AuthzService(collector, {
    epochReader: () => Promise.resolve(7),
    cacheEnabled: () => true,
  });
}

type RepositoryStub = {
  [K in keyof AuthzGrantsRepository]: ReturnType<typeof vi.fn>;
};

function makeGrantsService(overrides: Partial<RepositoryStub> = {}) {
  const repository: RepositoryStub = {
    createBinding: vi.fn().mockResolvedValue(undefined),
    updateBindingRole: vi.fn().mockResolvedValue(undefined),
    deleteBinding: vi.fn().mockResolvedValue(undefined),
    findBinding: vi.fn().mockResolvedValue({ id: "rb-1", organizationId: ORG }),
    findCustomRole: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    replaceBinding: vi.fn().mockResolvedValue(undefined),
    offboardUser: vi.fn().mockResolvedValue(undefined),
    findOwnedApiKeys: vi.fn().mockResolvedValue([]),
    findPersonalTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const bumpEpoch = vi.fn().mockResolvedValue(undefined);
  const service = new GrantsService(
    repository as unknown as AuthzGrantsRepository,
    {
      newBindingId: () => "rb_test_ksuid",
      bumpEpoch,
      collectorFor: (reader: AuthzReadRepository) =>
        new AuthzCollectorService(reader),
      now: () => NOW,
    },
  );
  return { service, repository, bumpEpoch };
}

const actor = { userId: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("granting access with an end date", () => {
  describe("when the end date is still ahead", () => {
    /** @scenario "Access granted until a date works before that date" */
    it("allows what the binding carries", async () => {
      const { authz } = makeAuthz({
        bindings: [adminBinding(new Date(NOW + 7 * DAY))],
        now: () => NOW,
      });

      expect(
        await authz.can({
          principal: alice,
          permission: MANAGE,
          scope: orgScope,
        }),
      ).toBe(true);
    });

    /** @scenario "A grant with no end date keeps granting" */
    it("allows a binding that names no end date at all, a year on", async () => {
      const { authz } = makeAuthz({
        bindings: [adminBinding(null)],
        now: () => NOW + 365 * DAY,
      });

      expect(
        await authz.can({
          principal: alice,
          permission: MANAGE,
          scope: orgScope,
        }),
      ).toBe(true);
    });
  });

  describe("when the end date has passed", () => {
    /** @scenario "Access granted until a date stops working after it" */
    it("denies what the binding carried", async () => {
      const { authz } = makeAuthz({
        bindings: [adminBinding(new Date(NOW - MINUTE))],
        now: () => NOW,
      });

      expect(
        await authz.can({
          principal: alice,
          permission: MANAGE,
          scope: orgScope,
        }),
      ).toBe(false);
    });

    // The read boundary the write surface is held to: a binding ending at
    // this exact instant is over, not still running.
    it("denies a binding ending at this very instant", async () => {
      const { authz } = makeAuthz({
        bindings: [adminBinding(new Date(NOW))],
        now: () => NOW,
      });

      expect(
        await authz.can({
          principal: alice,
          permission: MANAGE,
          scope: orgScope,
        }),
      ).toBe(false);
    });

    /** @scenario "An elapsed grant is refused as an ordinary permission denial" */
    it("answers the same denial an absent binding answers", async () => {
      const elapsed = makeAuthz({
        bindings: [adminBinding(new Date(NOW - MINUTE))],
        now: () => NOW,
      });
      const absent = makeAuthz({ bindings: [], now: () => NOW });

      const expired = await elapsed.authz.check({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      });
      const never = await absent.authz.check({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      });

      expect(expired.allowed).toBe(false);
      expect(expired.denialReason).toBe(never.denialReason);
      expect(expired.matchedBinding).toBeUndefined();
      // Nothing about the decision says "expired": the grant is simply not
      // there, and a second denial vocabulary would be a leak rather than a
      // kindness.
      expect(Object.keys(expired).sort()).toEqual(Object.keys(never).sort());
    });

    /** @scenario "A grant that reaches its end date is not recorded as revoked" */
    it("writes nothing when the date passes — the row is only read past", async () => {
      const rows = [adminBinding(new Date(NOW - MINUTE))];
      const { reader, authz } = makeAuthz({ bindings: rows, now: () => NOW });

      await authz.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      });

      // The read port carries no write at all, so "no revocation was
      // recorded" is asserted where it can be: the collect touched storage
      // exactly once, to READ, and the row it read is unchanged.
      expect(reader.findUserBindings).toHaveBeenCalledTimes(1);
      expect(rows[0]?.expiresAt).toEqual(new Date(NOW - MINUTE));
    });
  });
});

describe("GrantsService.attach with an end date", () => {
  describe("when the end date is in the past", () => {
    /** @scenario "Granting access that ends in the past is refused" */
    it("refuses with grant_expiry_in_past and writes nothing", async () => {
      const { service, repository, bumpEpoch } = makeGrantsService();

      await expect(
        service.attach({
          actor,
          who: dana,
          role: memberRole,
          where: teamScope,
          expiresAtMs: NOW - DAY,
        }),
      ).rejects.toMatchObject({ code: "grant_expiry_in_past" });

      expect(repository.createBinding).not.toHaveBeenCalled();
      expect(bumpEpoch).not.toHaveBeenCalled();
    });
  });

  describe("when the end date is this very instant", () => {
    /** @scenario "An end date of exactly now is refused" */
    it("refuses it, on the same boundary the read uses", async () => {
      const { service, repository } = makeGrantsService();

      await expect(
        service.attach({
          actor,
          who: dana,
          role: memberRole,
          where: teamScope,
          expiresAtMs: NOW,
        }),
      ).rejects.toMatchObject({ code: "grant_expiry_in_past" });

      expect(repository.createBinding).not.toHaveBeenCalled();
    });
  });

  describe("when the end date is ahead", () => {
    it("writes the term onto the binding row", async () => {
      const { service, repository, bumpEpoch } = makeGrantsService();

      await service.attach({
        actor,
        who: dana,
        role: memberRole,
        where: teamScope,
        expiresAtMs: NOW + 7 * DAY,
      });

      expect(repository.createBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          row: expect.objectContaining({ expiresAtMs: NOW + 7 * DAY }),
        }),
      );
      expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });

  describe("when no end date is given", () => {
    it("leaves the key off the row entirely", async () => {
      const { service, repository } = makeGrantsService();

      await service.attach({
        actor,
        who: dana,
        role: memberRole,
        where: teamScope,
      });

      const call = repository.createBinding.mock.calls[0] as
        | [{ row: Record<string, unknown> }]
        | undefined;
      expect(call).toBeDefined();
      expect("expiresAtMs" in (call?.[0].row ?? {})).toBe(false);
    });
  });

  describe("when the same access is already granted", () => {
    /** @scenario "Re-granting the same access with a different end date is a duplicate" */
    it("reports the duplicate rather than re-dating the existing grant", async () => {
      const { service, repository } = makeGrantsService({
        createBinding: vi.fn().mockRejectedValue(new DuplicateBindingError()),
      });

      await expect(
        service.attach({
          actor,
          who: dana,
          role: memberRole,
          where: teamScope,
          expiresAtMs: NOW + 7 * DAY,
        }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });

      // The write is the only thing that could have moved the existing row's
      // date, and it was refused: nothing else was called.
      expect(repository.updateBindingRole).not.toHaveBeenCalled();
      expect(repository.replaceBinding).not.toHaveBeenCalled();
    });
  });
});

describe("revoking a grant that has an end date", () => {
  /** @scenario "Revoking an expiring grant early still works" */
  it("deletes the binding before its date and bumps the epoch", async () => {
    const { service, repository, bumpEpoch } = makeGrantsService();

    await service.revoke({ actor, bindingId: "rb-1", organizationId: ORG });

    expect(repository.deleteBinding).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "rb-1", organizationId: ORG }),
    );
    // Unlike an expiry, a revocation IS a write, and the epoch bump is what
    // makes it felt on the caller's very next request.
    expect(bumpEpoch).toHaveBeenCalledWith({ organizationId: ORG });
  });
});

describe("the cost of not writing anything when a grant ends", () => {
  // The window is measured in wall clock, so a fake one moves through it
  // instantly - a real sleep would buy the same assertions at the price of
  // thirty seconds in every run.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A grant that ends is felt on the next collect, not instantly" */
  it("keeps answering from a snapshot taken before the moment, and denies once reassembled", async () => {
    const bindings = [adminBinding(new Date(NOW + 1_000))];
    const cached = makeCachedAuthz(bindings);
    expect(
      await cached.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      }),
    ).toBe(true);

    // Two seconds later the grant is over - and nothing was written, so the
    // epoch has not moved and the held snapshot is still considered current.
    vi.setSystemTime(NOW + 2_000);
    expect(
      await cached.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      }),
    ).toBe(true);

    // A caller who assembles the answer fresh sees the truth.
    const uncached = makeAuthz({ bindings, now: () => Date.now() });
    expect(
      await uncached.authz.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      }),
    ).toBe(false);
  });

  /** @scenario "A stale answer cannot outlive the cache's own ceiling" */
  it("reassembles once the snapshot passes its absolute age bound", async () => {
    const cached = makeCachedAuthz([adminBinding(new Date(NOW + 1_000))]);
    expect(
      await cached.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      }),
    ).toBe(true);

    // Past the 30s ceiling the entry is dropped whatever the epoch says, so
    // the window in which an ended grant can still answer is bounded.
    vi.setSystemTime(NOW + 31_000);
    expect(
      await cached.can({
        principal: alice,
        permission: MANAGE,
        scope: orgScope,
      }),
    ).toBe(false);
  });
});
