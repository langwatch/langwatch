/**
 * A grant's end date: refused when already passed, dropped by the collector once it passes,
 * never written as a revocation.
 * @see modules/authz/specs/expiring-grants.feature
 */
import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  grantAttachedPayloadSchema,
  type CollectedBinding,
  type GrantFact,
} from "@langwatch/authz-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthzCompatibilityLedger } from "../app/authz.app.ts";
import { AuthzGrantProjection } from "../eventing/authz-grant.projection.ts";
import { StubAuthzEpoch } from "../repositories/__tests__/support/authz-epoch.stub.ts";
import { StubAuthzListingRepository } from "../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../repositories/__tests__/support/authz-read.stub.ts";
import {
  AuthzGrantProjectionRepository,
  type GrantProjectionWrite,
} from "../repositories/authz-grant-projection.repository.ts";
import type { AuthzGrantRepository } from "../repositories/authz-grant.repository.ts";
import { bindingIdentityKey } from "../repositories/eventing/eventing.authz-grant.mapper.ts";
import {
  grantFactToRow,
  grantRowToFact,
} from "../repositories/prisma/prisma.authz-grant.mapper.ts";
import { bindingWire } from "../rules/role-binding-read-back.rules.ts";
import {
  permissiveGrantGuards,
  TEST_CALLER,
} from "../services/__tests__/support/grant-guards.stub.ts";
import { AuthzGrantWriterService } from "../services/authz-grant-writer.service.ts";
import { AuthzGrantsService } from "../services/authz-grants.service.ts";
import { AuthzService } from "../services/authz.service.ts";

const ORG = "org_acme";
const TEAM = "team_1";
const PROJECT = "proj_1";
const DAY_MS = 24 * 60 * 60 * 1000;
const THURSDAY = Temporal.Instant.from("2026-10-01T09:00:00Z").epochMilliseconds;
const FRIDAY = THURSDAY + DAY_MS;
const MONDAY = THURSDAY + 4 * DAY_MS;

const dana = { type: "user", id: "dana" } as const;
const projectScope = { type: "project", id: PROJECT, teamId: TEAM, organizationId: ORG } as const;
const actor = { userId: "admin_1" };

const projectBinding = (expiresAtMs?: number): CollectedBinding => ({
  roleKey: "viewer",
  scopeType: "PROJECT",
  scopeId: PROJECT,
  viaGroupId: null,
  ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
});

function authzFor(bindings: CollectedBinding[], { cached = false } = {}) {
  const reader = makeReader({
    findOrganizationMembership: vi.fn().mockResolvedValue({ role: "MEMBER", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue(bindings),
  });
  const epoch = new StubAuthzEpoch();
  epoch.findEpoch.mockResolvedValue(1);
  const authz = AuthzService.create({
    repository: reader,
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    isOnEngine: async () => true,
    ...(cached ? { epoch, cacheEnabled: () => true } : {}),
  });
  return { authz, reader, epoch };
}

const canView = (authz: AuthzService) =>
  authz.can({ principal: dana, permission: "traces:view", scope: projectScope });

function grantsService() {
  const repository = {
    createBinding: vi.fn().mockResolvedValue(undefined),
    updateBindingRole: vi.fn().mockResolvedValue(undefined),
    deleteBinding: vi.fn().mockResolvedValue(undefined),
    findBinding: vi.fn().mockResolvedValue({ id: "rb_1", organizationId: ORG }),
    findCustomRole: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    findProjectLineage: vi.fn().mockResolvedValue({ organizationId: ORG, teamId: TEAM }),
    replaceBinding: vi.fn().mockResolvedValue(undefined),
    offboardUser: vi.fn(),
    findDirectoryOrganizationGrantIds: vi.fn().mockResolvedValue([]),
    findDirectoryCausedChanges: vi.fn().mockResolvedValue([]),
    findOwnedApiKeys: vi.fn().mockResolvedValue([]),
    findPersonalTeams: vi.fn().mockResolvedValue([]),
  } satisfies AuthzGrantRepository;
  const epoch = new StubAuthzEpoch();
  const ledger = compatibilityLedger();
  const service = AuthzGrantsService.create({
    permissions: permissiveGrantGuards,
    repository,
    ledger,
    epoch,
    newBindingId: () => "rb_new",
    bindings: new StubAuthzManagedGrantRepository(),
  });
  return { service, repository, epoch, ledger };
}

function compatibilityLedger() {
  return {
    attachBindings: vi
      .fn<AuthzCompatibilityLedger["attachBindings"]>()
      .mockResolvedValue({ attached: [], duplicates: [] }),
    attachResourceGrant: vi.fn<AuthzCompatibilityLedger["attachResourceGrant"]>(),
    revokeResourceGrants: vi.fn<AuthzCompatibilityLedger["revokeResourceGrants"]>(),
    changeBindingRole: vi.fn<AuthzCompatibilityLedger["changeBindingRole"]>(),
    revokeBindings: vi.fn<AuthzCompatibilityLedger["revokeBindings"]>(),
    revokeBindingsWhere: vi.fn<AuthzCompatibilityLedger["revokeBindingsWhere"]>(),
    offboardMember: vi.fn<AuthzCompatibilityLedger["offboardMember"]>(),
    defineRole: vi.fn<AuthzCompatibilityLedger["defineRole"]>(),
    deleteRole: vi.fn<AuthzCompatibilityLedger["deleteRole"]>(),
  } satisfies AuthzCompatibilityLedger;
}

function bindingWriter() {
  const bindings = new StubAuthzManagedGrantRepository();
  bindings.findScopeRows.mockResolvedValue([
    { type: "TEAM", id: TEAM, name: "Shared", personalWorkspaceName: null },
  ]);
  bindings.findOrganizationRole.mockResolvedValue("MEMBER");
  const ledger = compatibilityLedger();
  const writer = AuthzGrantWriterService.create({
    permissions: permissiveGrantGuards,
    bindings,
    ledger,
    newBindingId: () => "rb_new",
  });
  const create = (expiresAt?: Date) =>
    writer.create({
      organizationId: ORG,
      userId: "dana",
      role: "MEMBER",
      scopeType: "TEAM",
      scopeId: TEAM,
      actor: { type: "user", id: "admin_1" },
      caller: TEST_CALLER,
      ...(expiresAt ? { expiresAt } : {}),
    });
  return { create, ledger };
}

const grantFact = (overrides: Partial<GrantFact> = {}): GrantFact => ({
  grantId: "grant_1",
  principal: { type: "user", id: "dana" },
  roleKey: "member",
  scope: { type: "TEAM", id: TEAM },
  source: "grants-service",
  occurredAtMs: THURSDAY,
  ...overrides,
});

class NullAuthzGrantProjectionRepository extends AuthzGrantProjectionRepository {
  async append(_write: GrantProjectionWrite, _context: ProjectionStoreContext): Promise<void> {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(THURSDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given a grant with an end date", () => {
  /** @scenario "Access granted until a date works before that date" */
  it("allows the access before that date", async () => {
    expect(await canView(authzFor([projectBinding(FRIDAY)]).authz)).toBe(true);
  });

  /** @scenario "Access granted until a date stops working after it" */
  it("denies the access after it", async () => {
    vi.setSystemTime(MONDAY);

    expect(await canView(authzFor([projectBinding(FRIDAY)]).authz)).toBe(false);
  });

  /** @scenario "An elapsed grant is refused as an ordinary permission denial" */
  it("refuses exactly as a caller who never held the grant is refused", async () => {
    vi.setSystemTime(MONDAY);
    const refusalOf = (bindings: CollectedBinding[]) =>
      authzFor(bindings)
        .authz.authorize({ principal: dana, permission: "traces:view", scope: projectScope })
        .catch((error: unknown) => error);

    const elapsed = await refusalOf([projectBinding(FRIDAY)]);
    const never = await refusalOf([]);

    expect(elapsed).toMatchObject({ code: "permission_denied" });
    expect(elapsed).toEqual(never);
    expect(JSON.stringify(elapsed)).not.toContain("expir");
  });

  /** @scenario "A grant that reaches its end date is not recorded as revoked" */
  it("writes nothing when the moment passes: the read simply stops counting it", async () => {
    const { authz, reader, epoch } = authzFor([projectBinding(FRIDAY)], { cached: true });
    vi.setSystemTime(MONDAY);

    expect(await canView(authz)).toBe(false);
    expect(epoch.bump).not.toHaveBeenCalled();
    expect(Object.keys(reader).filter((member) => !member.startsWith("find"))).toEqual([]);
  });

  /** @scenario "A grant with no end date keeps granting" */
  it("keeps granting a grant with no end date a year later", async () => {
    vi.setSystemTime(THURSDAY + 365 * DAY_MS);

    expect(await canView(authzFor([projectBinding()]).authz)).toBe(true);
  });
});

describe("when an end date is not in the future", () => {
  const attachEnding = (expiresAtMs: number) => {
    const { service, repository } = grantsService();
    const attempt = service.attach({
      actor,
      who: dana,
      role: { builtin: "VIEWER" },
      where: { type: "team", id: TEAM, organizationId: ORG },
      expiresAtMs,
    });
    return { attempt, repository };
  };

  /** @scenario "Granting access that ends in the past is refused" */
  it("refuses an end date already passed and writes nothing", async () => {
    const { attempt, repository } = attachEnding(THURSDAY - DAY_MS);

    await expect(attempt).rejects.toMatchObject({ code: "grant_expiry_in_past", httpStatus: 422 });
    expect(repository.createBinding).not.toHaveBeenCalled();
  });

  /** @scenario "An end date of exactly now is refused" */
  it("refuses an end date of this very instant", async () => {
    const { attempt, repository } = attachEnding(THURSDAY);

    await expect(attempt).rejects.toMatchObject({ code: "grant_expiry_in_past" });
    expect(repository.createBinding).not.toHaveBeenCalled();
  });

  it("refuses it on the batch attach other features call too", async () => {
    const { service, ledger } = grantsService();
    const binding = {
      bindingId: "rb_1",
      principal: { userId: "dana" },
      role: "MEMBER" as const,
      customRoleId: null,
      scopeType: "TEAM" as const,
      scopeId: TEAM,
      expiresAtMs: THURSDAY,
    };

    await expect(
      service.attachBindings({
        organizationId: ORG,
        bindings: [binding],
        caller: { type: "system" },
        actor: { type: "user", id: "admin_1" },
        onDuplicate: "attach",
      }),
    ).rejects.toMatchObject({ code: "grant_expiry_in_past" });
    expect(ledger.attachBindings).not.toHaveBeenCalled();
  });
});

describe("given a grant that ends next Friday", () => {
  /** @scenario "Revoking an expiring grant early still works" */
  it("revokes early, and the revocation retires cached answers at once", async () => {
    const { service, repository, epoch } = grantsService();
    await service.attach({
      actor,
      who: dana,
      role: { builtin: "VIEWER" },
      where: { type: "team", id: TEAM, organizationId: ORG },
      expiresAtMs: FRIDAY,
    });
    epoch.bump.mockClear();

    await service.revoke({ actor, bindingId: "rb_1", organizationId: ORG });

    expect(repository.deleteBinding).toHaveBeenCalledTimes(1);
    expect(epoch.bump).toHaveBeenCalledWith({ organizationId: ORG });
  });

  /** @scenario "Reducing an expiring grant keeps its end date" */
  it("narrows it with the end date the caller states on the replacement", async () => {
    const { service, repository } = grantsService();

    await service.replace({
      actor,
      who: dana,
      from: { type: "organization", id: ORG },
      to: { type: "team", id: TEAM, organizationId: ORG },
      role: { builtin: "VIEWER" },
      expiresAtMs: FRIDAY,
    });

    expect(repository.replaceBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ scopeType: "TEAM", scopeId: TEAM, expiresAtMs: FRIDAY }),
      }),
    );
  });

  /** @scenario "Re-granting the same access with a different end date is a second grant" */
  it("writes a second binding carrying its own end date", async () => {
    const identity = {
      principal: { userId: "dana" },
      scopeType: "PROJECT",
      scopeId: PROJECT,
      role: "VIEWER",
      customRoleId: null,
    };

    const expiring = { ...identity, expiresAtMs: FRIDAY };

    expect(bindingIdentityKey(expiring)).toBe(bindingIdentityKey(identity));

    const { service, repository } = grantsService();
    await service.attach({
      actor,
      who: dana,
      role: { builtin: "VIEWER" },
      where: projectScope,
      expiresAtMs: FRIDAY,
    });
    expect(repository.createBinding).toHaveBeenCalledWith(
      expect.objectContaining({ row: expect.objectContaining({ expiresAtMs: FRIDAY }) }),
    );
  });
});

describe("given an answer assembled before a grant's end date", () => {
  /** @scenario "A grant that ends is felt on the next collect, not instantly" */
  it("may answer from the held snapshot, while a fresh collect denies", async () => {
    const { authz } = authzFor([projectBinding(THURSDAY + 1000)], { cached: true });
    expect(await canView(authz)).toBe(true);

    vi.advanceTimersByTime(2000);

    expect(await canView(authz)).toBe(true);
    expect(await canView(authzFor([projectBinding(THURSDAY + 1000)]).authz)).toBe(false);
  });

  /** @scenario "A stale answer cannot outlive the cache's own ceiling" */
  it("reassembles after thirty seconds, and the ended grant no longer counts", async () => {
    const { authz, reader } = authzFor([projectBinding(THURSDAY + 1000)], { cached: true });
    expect(await canView(authz)).toBe(true);

    vi.advanceTimersByTime(30_001);

    expect(await canView(authz)).toBe(false);
    expect(reader.findUserBindings).toHaveBeenCalledTimes(2);
  });
});

describe("given the projection of a grant", () => {
  const projection = AuthzGrantProjection.create(new NullAuthzGrantProjectionRepository());
  const attached = (data: Record<string, unknown>) =>
    projection.map({
      id: "event_1",
      aggregateId: "grant_1",
      aggregateType: "authz_grant",
      tenantId: createTenantId(ORG),
      createdAt: THURSDAY,
      occurredAt: THURSDAY,
      version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
      type: GRANT_ATTACHED_EVENT_TYPE,
      data: grantAttachedPayloadSchema.parse({
        grantId: "grant_1",
        principal: { type: "user", id: "dana" },
        roleKey: "member",
        scope: { type: "TEAM", id: TEAM },
        source: "grants-service",
        actor: { type: "user", id: "admin_1" },
        ...data,
      }),
    });

  /** @scenario "A grant recorded before end dates existed still grants" */
  it("writes no end date for a fact that carries none, and reads back the same fact", () => {
    expect(attached({})).toMatchObject({ kind: "grant.upsert", row: { expiresAt: null } });

    const older = grantFact();
    const back = grantRowToFact(grantFactToRow({ grant: older, organizationId: ORG }));

    expect(back).toEqual(older);
    expect("expiresAtMs" in back).toBe(false);
  });

  /** @scenario "A grant's end date survives a round trip through the projection" */
  it("stores the end date on the row and reads back the same fact", () => {
    expect(attached({ expiresAtMs: FRIDAY })).toMatchObject({
      row: { expiresAt: Temporal.Instant.fromEpochMilliseconds(FRIDAY) },
    });

    const expiring = grantFact({ expiresAtMs: FRIDAY });

    expect(grantRowToFact(grantFactToRow({ grant: expiring, organizationId: ORG }))).toEqual(
      expiring,
    );
  });

  /** @scenario "A shared resource states its end date in its own terms" */
  it("refuses a resource fact that also states an end date of its own", () => {
    const resourceFact = {
      grantId: "grant_2",
      principal: { type: "anyone", id: null },
      roleKey: null,
      scope: { type: "RESOURCE", id: "trace_1" },
      resource: { kind: "trace", projectId: PROJECT, token: "tok_1", permission: "traces:view" },
      source: "grants-service",
      actor: { type: "user", id: "admin_1" },
    };

    expect(() => grantAttachedPayloadSchema.parse(resourceFact)).not.toThrow();
    expect(() =>
      grantAttachedPayloadSchema.parse({ ...resourceFact, expiresAtMs: FRIDAY }),
    ).toThrow(/states its expiry inside those terms/);
  });
});

describe("the management API's create", () => {
  /** @scenario "Binding a role with an end date through the API" */
  it("records the end date alongside the grant", async () => {
    const { create, ledger } = bindingWriter();

    await create(toDate(Temporal.Instant.fromEpochMilliseconds(FRIDAY)));

    expect(ledger.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: [expect.objectContaining({ bindingId: "rb_new", expiresAtMs: FRIDAY })],
      }),
    );
  });

  /** @scenario "A binding with no end date reports none" */
  it("writes no end date and reads back none", async () => {
    const { create, ledger } = bindingWriter();

    await create();

    const [written] = ledger.attachBindings.mock.calls[0]?.[0].bindings ?? [];
    expect(written).toBeDefined();
    expect(written && "expiresAtMs" in written).toBe(false);
  });

  /** @scenario "Binding a role with an end date that has passed is refused" */
  it("refuses with 422 before anything is written", async () => {
    const { create, ledger } = bindingWriter();

    await expect(
      create(toDate(Temporal.Instant.fromEpochMilliseconds(THURSDAY - DAY_MS))),
    ).rejects.toMatchObject({ code: "grant_expiry_in_past", httpStatus: 422 });
    expect(ledger.attachBindings).not.toHaveBeenCalled();
  });

  /** @scenario "A binding whose access has ended is still listed" */
  it("lists an ended binding with the date its access ended", () => {
    const ended = toDate(Temporal.Instant.fromEpochMilliseconds(FRIDAY));
    vi.setSystemTime(MONDAY);

    const wire = bindingWire({
      id: "rb_1",
      userId: "dana",
      userName: "Dana",
      userEmail: null,
      userImage: null,
      groupId: null,
      groupName: null,
      groupScimSource: null,
      apiKeyId: null,
      apiKeyName: null,
      role: "VIEWER",
      customRoleId: null,
      customRoleName: null,
      scopeType: "PROJECT",
      scopeId: PROJECT,
      scopeName: null,
      memberUserIds: [],
      createdAt: toDate(Temporal.Instant.fromEpochMilliseconds(THURSDAY)),
      expiresAt: ended,
    });

    expect(wire).toMatchObject({ id: "rb_1", expiresAt: ended });
  });
});
