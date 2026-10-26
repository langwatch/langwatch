/**
 * The braid world: the composed authz app over memory twins, its grants pipeline running in
 * memory, and the real tRPC door asking the app's own decisions and a stated plan (ADR-185).
 * @see modules/authz/specs/braids.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { Temporal } from "@langwatch/time";
import { initTRPC } from "@trpc/server";

import type { AuthzAuditRow } from "../../repositories/authz-audit-trail.repository.ts";
import type { AuthzRepositories } from "../../repositories/authz.repositories.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "../../repositories/memory/memory.authz-admission.repository.ts";
import { MemoryAuthzAuditTrailRepository } from "../../repositories/memory/memory.authz-audit-trail.repository.ts";
import { MemoryAuthzBraidLockRepository } from "../../repositories/memory/memory.authz-braid-lock.repository.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzLineageEpochRepository } from "../../repositories/memory/memory.authz-lineage-epoch.repository.ts";
import { MemoryAuthzListingRepository } from "../../repositories/memory/memory.authz-listing.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "../../repositories/memory/memory.authz-managed-grant.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../../repositories/memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzMigrationRepository } from "../../repositories/memory/memory.authz-migration.repository.ts";
import { MemoryAuthzOrganizationPolicyRepository } from "../../repositories/memory/memory.authz-organization-policy.repository.ts";
import { MemoryAuthzPlatformGrantRepository } from "../../repositories/memory/memory.authz-platform-grant.repository.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../../repositories/memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzUserStandingRepository } from "../../repositories/memory/memory.authz-user-standing.repository.ts";
import {
  MemoryAuthzCutoverRepository,
  MemoryAuthzEpochRepository,
  MemoryAuthzSessionVersionRepository,
} from "../../repositories/memory/memory.authz.repositories.ts";
import { authzTrpcTransport } from "../../transport/authz.trpc.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

export const ORG = "org_acme";
export const SPECIALISTS = "proj_specialists";
export const ORCHESTRATOR = "proj_orchestrator";
export const FRONTDESK = "proj_frontdesk";
export const TEAMS = {
  specialists: "team_specialists",
  orchestrator: "team_orchestrator",
  frontdesk: "team_frontdesk",
} as const;
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

type TeamRole = "admin" | "member" | "viewer";
type Seat = Readonly<{ organizationAdmin?: boolean; teams?: Readonly<Record<string, TeamRole>> }>;
type DoorContext = { actor: { id: string } | null };

/** Every memory repository over one store, so the test can seed and read the rows. */
function repositoriesOver(memory: AuthzMemoryStore): AuthzRepositories {
  return {
    bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
    cutover: MemoryAuthzCutoverRepository.create({ memory }),
    admissions: MemoryAuthzAdmissionRepository.create({ memory }),
    userStandings: MemoryAuthzUserStandingRepository.create({ memory }),
    epoch: MemoryAuthzEpochRepository.create({ memory }),
    lineageEpochs: MemoryAuthzLineageEpochRepository.create({ memory }),
    sessionVersions: MemoryAuthzSessionVersionRepository.create({ memory }),
    auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
    platformGrants: MemoryAuthzPlatformGrantRepository.create({ memory }),
    membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
    grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
    revocation: MemoryAuthzRevocationRepository.create({ memory }),
    read: MemoryAuthzReadRepository.create({ memory }),
    listing: MemoryAuthzListingRepository.create({ memory }),
    migration: MemoryAuthzMigrationRepository.create({ memory }),
    ledgerReads: MemoryAuthzLedgerReadRepository.create({ memory }),
    braidLocks: MemoryAuthzBraidLockRepository.create(),
    organizationPolicies: MemoryAuthzOrganizationPolicyRepository.create(),
  };
}

/** The organisation of the Background: three plain projects, each in a team of its own. */
function seedOrganisation(memory: AuthzMemoryStore): void {
  for (const teamId of Object.values(TEAMS)) {
    memory.teams.push({
      id: teamId,
      organizationId: ORG,
      name: teamId,
      isPersonal: false,
      ownerUserId: null,
    });
  }
  for (const [id, teamId] of [
    [SPECIALISTS, TEAMS.specialists],
    [ORCHESTRATOR, TEAMS.orchestrator],
    [FRONTDESK, TEAMS.frontdesk],
  ] as const) {
    memory.projects.push({
      id,
      teamId,
      name: id,
      isPersonal: false,
      apiKey: `key_${id}`,
      createdAt: EPOCH,
    });
  }
}

type CommandName = "attachGrant" | "revokeGrant";

/** The registered senders, each of the two braid writes able to fail its next sends. */
function faultable(commands: Readonly<Record<string, unknown>>) {
  const failing: Record<CommandName, number> = { attachGrant: 0, revokeGrant: 0 };
  const wrap = (name: CommandName) => {
    const sender = commands[name] as { send: (data: unknown) => Promise<void> };
    return {
      send: async (data: unknown) => {
        if (failing[name] > 0) {
          failing[name]--;
          throw new Error(`${name} failed`);
        }
        await sender.send(data);
      },
    };
  };
  return {
    commands: { ...commands, attachGrant: wrap("attachGrant"), revokeGrant: wrap("revokeGrant") },
    failNext: (name: CommandName, times = 1) => {
      failing[name] = times;
    },
  };
}

export async function braidWorld({
  enterprise = true,
  epochCacheEnabled = false,
}: { enterprise?: boolean; epochCacheEnabled?: boolean } = {}) {
  const memory = AuthzMemoryStore.create();
  seedOrganisation(memory);
  const repositories = repositoriesOver(memory);
  const app = AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories,
  });
  const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const senders = faultable(eventing.register(app.eventingPipeline()).commands);
  app.connectCommands(senders.commands);
  const plan = { enterprise };

  const trpc = initTRPC.context<DoorContext>().create();
  const router = createTrpcRuntime<DoorContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<DoorContext>({
      overrides: {
        authorization: {
          forRequest: () => ({
            ...testAuthorizeDefaults,
            getDecision: (input) => app.getDecision(input),
            getProjectAnyDecision: (input) => app.getProjectAnyDecision(input),
            checkScopeLineage: (input) => app.checkScopeLineage(input),
          }),
        },
        entitlements: { holds: async () => plan.enterprise },
      },
    }),
  }).mount(authzTrpcTransport, () => app);

  const seated = MemoryAuthzGrantProjectionRepository.create({ memory });
  let seats = 0;
  /** Seats a person: an organisation membership and the grants their roles stand on. */
  async function seat(userId: string, { organizationAdmin = false, teams = {} }: Seat) {
    memory.memberships.set(memory.membershipKey(ORG, userId), {
      role: organizationAdmin ? "ADMIN" : "MEMBER",
      disabled: false,
      membershipStamp: `stamp_${userId}`,
      pendingSsoGrantId: null,
      createdAt: EPOCH,
    });
    const scopes: readonly (readonly [string, "ORGANIZATION" | "TEAM", string])[] = [
      ...(organizationAdmin ? [["admin", "ORGANIZATION", ORG] as const] : []),
      ...Object.entries(teams).map(([teamId, role]) => [role, "TEAM", teamId] as const),
    ];
    for (const [roleKey, scopeType, scopeId] of scopes) {
      await seated.append({
        kind: "grant.upsert",
        row: {
          id: `grant_seat_${++seats}`,
          organizationId: ORG,
          principalType: "USER",
          principalId: userId,
          legacyRole: null,
          source: "grants-service",
          token: null,
          permission: null,
          resourceKind: null,
          projectId: null,
          createdByUserId: null,
          expiresAt: null,
          maxViews: null,
          occurredAt: EPOCH,
          roleKey,
          scopeType,
          scopeId,
        },
      });
    }
  }

  return {
    app,
    memory,
    repositories,
    plan,
    seat,
    /** The next sends of one ledger command fail, as a queue that is down would. */
    failNext: senders.failNext,
    /** The procedures as the signed-in person calls them, through the door. */
    as: (userId: string) => router.createCaller({ actor: { id: userId } }),
    /** The proof a trace read in `projectId` carries for `userId`, minted by the app. */
    mint: async (userId: string, projectId: string) => {
      const scope = await app.getScope({ projectId });
      if (scope.type !== "project") throw new Error(`${projectId} is not a project`);
      const { authorization } = await app.authorize({
        principal: { type: "user", id: userId },
        permission: "traces:view",
        scope,
        proof: {
          actor: { type: "user", id: userId },
          purpose: { kind: "route", route: "traces.getTrace" },
        },
      });
      if (!authorization) throw new Error("the app minted no proof");
      return authorization;
    },
    /** Every braid grant row, live or revoked, in the order attached. */
    braidRows: () => memory.grants.filter((row) => row.source === "braid"),
    auditRows: (): AuthzAuditRow[] => [...memory.auditLogs],
    close: () => eventing.close(),
  };
}

type Failure = Readonly<{ code: string; meta?: Readonly<Record<string, unknown>> }>;

/** The handled error a refused call carries, the door's or the application's; none on success. */
export async function failureOf(call: Promise<unknown>): Promise<Failure | undefined> {
  return call.then(
    () => undefined,
    (error: unknown) => handledIn(error),
  );
}

/** The refused call's code alone. */
export async function refusalOf(call: Promise<unknown>): Promise<string | undefined> {
  return (await failureOf(call))?.code;
}

function handledIn(error: unknown): Failure {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    const { code, meta } = at as { code?: unknown; meta?: Record<string, unknown> };
    if (typeof code === "string" && /^[a-z_]+$/.test(code)) return { code, meta };
  }
  return { code: String((error as { code?: unknown }).code ?? error) };
}
