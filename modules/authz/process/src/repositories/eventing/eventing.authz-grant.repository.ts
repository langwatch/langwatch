/**
 * Ledger-backed AuthzGrantsRepository: writes emit commands; binding and role
 * reads use the live grant and role heads. Fail-safe atomicity through per-org
 * FIFO (ADR-092 §13).
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  BindingMissingError,
  DuplicateBindingError,
  type GrantEventSource,
  OffboardIncompleteError,
  type OffboardCounts,
} from "@langwatch/authz-contract";
import { z } from "zod";

import type { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import {
  AuthzGrantRepository,
  type BindingPrincipalWhere,
  type DirectoryCausedGrantChange,
  type RoleBindingWrite,
} from "../authz-grant.repository.ts";
import type { AuthzDatabase, AuthzReadRepository } from "../authz-read.repository.ts";
import {
  compatBindingFromGrantFact,
  GRANT_ROW_COLUMNS,
  grantRowFromStored,
  grantRowToFact,
  PRINCIPAL_TO_DB,
} from "../prisma/prisma.authz-grant.mapper.ts";
import {
  type GrantWriteRecord,
  PrismaAuthzGrantRepository,
  type PrismaAuthzGrantDatabase,
  type WriteDelegate,
} from "../prisma/prisma.authz-grant.repository.ts";
import {
  isRecordNotFound,
  isUniqueViolation,
  principalForWhere,
} from "../prisma/prisma.authz-ledger.mapper.ts";
import { liveGrants, liveRoles } from "./eventing.authz-live-rows.mapper.ts";
import { EventingAuthzReadRepository } from "./eventing.authz-read.repository.ts";

/**
 * Restore the port's two typed failures (DuplicateBindingError,
 * BindingMissingError) from any ledger write path; everything else passes.
 */
async function runLedgerWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    rethrowLedgerFailure(error);
  }
}

function rethrowLedgerFailure(error: unknown): never {
  if (error instanceof DuplicateBindingError || error instanceof BindingMissingError) {
    throw error;
  }
  if (isUniqueViolation(error)) {
    throw new DuplicateBindingError();
  }
  if (isRecordNotFound(error)) {
    throw new BindingMissingError();
  }
  throw error;
}

/**
 * Membership-deletion transaction needs explicit budget (timeout + maxWait)
 * because prove holds row locks while reading.
 */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

export type AuthzGrantWriteDatabase = Omit<
  AuthzDatabase,
  "roleBinding" | "grant" | "groupMembership" | "teamUser" | "organizationUser" | "user"
> & {
  roleBinding: WriteDelegate;
  grant: WriteDelegate<GrantWriteRecord>;
  groupMembership: WriteDelegate;
  teamUser: WriteDelegate;
  organizationUser: WriteDelegate;
  organizationInvite: WriteDelegate;
  user: WriteDelegate<{ email: string | null }>;
  $transaction<T>(
    write: (transaction: AuthzGrantWriteDatabase) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ): Promise<T>;
};

export type EventingAuthzGrantRepositoryOptions = {
  database: AuthzGrantWriteDatabase & PrismaAuthzGrantDatabase;
  writer: Pick<
    EventingAuthzLedgerAdapter,
    | "attachBindings"
    | "changeBindingRole"
    | "revokeBindings"
    | "revokeBindingsWhere"
    | "offboardMember"
  >;
};

const grantIdRowsSchema = z.array(z.object({ id: z.string() }));
const customRoleRowSchema = z
  .object({ organizationId: z.string(), permissions: z.unknown() })
  .nullable();

export class EventingAuthzGrantRepository extends AuthzGrantRepository {
  private readonly reads: PrismaAuthzGrantRepository;

  static create(options: EventingAuthzGrantRepositoryOptions): EventingAuthzGrantRepository {
    return new EventingAuthzGrantRepository(options);
  }

  private constructor(private readonly options: EventingAuthzGrantRepositoryOptions) {
    super();
    this.reads = PrismaAuthzGrantRepository.create(options.database);
  }

  /** A live grant a role binding can express, or null. */
  async findBinding({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null> {
    const stored = await liveGrants(this.options.database).findFirst({
      where: { id: bindingId },
      select: GRANT_ROW_COLUMNS,
    });
    if (stored === null || stored === undefined) return null;
    const row = grantRowFromStored(stored);
    const compat = compatBindingFromGrantFact({
      grant: grantRowToFact(row),
      organizationId: row.organizationId,
    });
    return compat.kind === "compat"
      ? { id: compat.row.id, organizationId: compat.row.organizationId }
      : null;
  }

  /** A live role definition, from the canonical role head. */
  async findCustomRole({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    return customRoleRowSchema.parse(
      (await liveRoles(this.options.database).findFirst({
        where: { id: customRoleId },
        select: { organizationId: true, permissions: true },
      })) ?? null,
    );
  }

  // Arrow instance properties, matching the base class's property-typed
  // abstract members (ScopeLineageRepository declares them that way for
  // test mocks).
  findTeamOrganization = (
    ...args: Parameters<PrismaAuthzGrantRepository["findTeamOrganization"]>
  ): ReturnType<PrismaAuthzGrantRepository["findTeamOrganization"]> => {
    return this.reads.findTeamOrganization(...args);
  };

  findProjectLineage = (
    ...args: Parameters<PrismaAuthzGrantRepository["findProjectLineage"]>
  ): ReturnType<PrismaAuthzGrantRepository["findProjectLineage"]> => {
    return this.reads.findProjectLineage(...args);
  };

  findOwnedApiKeys(
    ...args: Parameters<PrismaAuthzGrantRepository["findOwnedApiKeys"]>
  ): ReturnType<PrismaAuthzGrantRepository["findOwnedApiKeys"]> {
    return this.reads.findOwnedApiKeys(...args);
  }

  findPersonalTeams(
    ...args: Parameters<PrismaAuthzGrantRepository["findPersonalTeams"]>
  ): ReturnType<PrismaAuthzGrantRepository["findPersonalTeams"]> {
    return this.reads.findPersonalTeams(...args);
  }

  /** @throws DuplicateBindingError on an identical binding at this scope. */
  async createBinding({
    row,
    actor,
    source,
  }: {
    row: RoleBindingWrite;
    actor: LedgerActor;
    source?: GrantEventSource;
  }): Promise<void> {
    const { organizationId, ...binding } = row;
    await runLedgerWrite(() =>
      this.options.writer.attachBindings({
        organizationId,
        bindings: [binding],
        actor,
        // Omitted rather than defaulted here: the writer owns the default,
        // and stating it twice is how the two drift apart.
        ...(source ? { source } : {}),
        onDuplicate: "reject",
      }),
    );
  }

  /**
   * @throws DuplicateBindingError when a sibling already holds the target role.
   * @throws BindingMissingError when the row is gone.
   */
  async updateBindingRole({
    bindingId,
    organizationId,
    role,
    customRoleId,
    actor,
  }: {
    bindingId: string;
    organizationId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void> {
    await runLedgerWrite(() =>
      this.options.writer.changeBindingRole({
        organizationId,
        bindingId,
        role,
        customRoleId,
        actor,
      }),
    );
  }

  /** @throws BindingMissingError when the row is gone. */
  async deleteBinding({
    bindingId,
    organizationId,
    actor,
  }: {
    bindingId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void> {
    // A ledger revoke of an absent id is a no-op; the port's contract is
    // that a row gone between the caller's pre-read and this write reads
    // as missing, so the existence check stays explicit.
    const existing = await this.findBinding({ bindingId });
    if (existing?.organizationId !== organizationId) throw new BindingMissingError();
    await runLedgerWrite(() =>
      this.options.writer.revokeBindings({
        organizationId,
        bindingIds: [bindingId],
        actor,
      }),
    );
  }

  /**
   * @throws BindingMissingError when the delete matched nothing.
   * @throws DuplicateBindingError when the narrower binding already exists.
   */
  async replaceBinding({
    deleteWhere,
    create,
    actor,
  }: {
    deleteWhere: {
      organizationId: string;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
      principal: BindingPrincipalWhere;
    };
    create: RoleBindingWrite;
    actor: LedgerActor;
  }): Promise<void> {
    // Refuse before emitting writes when the original grant is absent. A
    // lagging projection can report it absent; retry leaves access unchanged.
    const principal = principalForWhere(deleteWhere.principal);
    const existing = await liveGrants(this.options.database).findFirst({
      where: {
        organizationId: deleteWhere.organizationId,
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        principalType: PRINCIPAL_TO_DB[principal.type],
        principalId: principal.id,
      },
      select: { id: true },
    });
    if (existing === null || existing === undefined) throw new BindingMissingError();

    await runLedgerWrite(() =>
      this.options.writer.revokeBindingsWhere({
        organizationId: deleteWhere.organizationId,
        where: {
          scopeType: deleteWhere.scopeType,
          scopeId: deleteWhere.scopeId,
          ...deleteWhere.principal,
        },
        actor,
        reason: "replaced by a narrower grant",
      }),
    );
    const { organizationId, ...binding } = create;
    await runLedgerWrite(() =>
      this.options.writer.attachBindings({
        organizationId,
        bindings: [binding],
        actor,
        onDuplicate: "reject",
      }),
    );
  }

  async findDirectoryOrganizationGrantIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    if (userIds.length === 0) return [];

    const rows = await this.options.database.grant.findMany({
      where: {
        organizationId,
        principalType: "USER",
        principalId: { in: [...userIds] },
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        source: "scim",
        revokedAt: null,
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findDirectoryCausedChanges({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<DirectoryCausedGrantChange[]> {
    const directory = {
      organizationId,
      principalType: "USER",
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      source: "scim",
    } as const;
    // Two reads because they are two orderings: a grant written last year and
    // taken back this morning is the most recent REMOVAL and one of the
    // oldest attachments, and one `orderBy` cannot say both.
    const [attached, removed] = await Promise.all([
      this.options.database.grant.findMany({
        where: directory,
        select: { id: true, principalId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      this.options.database.grant.findMany({
        where: { ...directory, revokedAt: { not: null } },
        select: { id: true, principalId: true, revokedAt: true },
        orderBy: { revokedAt: "desc" },
        take: limit,
      }),
    ]);

    const changes: DirectoryCausedGrantChange[] = [
      ...attached.map((row) => ({
        grantId: row.id,
        userId: row.principalId,
        kind: "attached" as const,
        occurredAtMs: row.createdAt.getTime(),
      })),
      ...removed.flatMap((row) =>
        row.revokedAt
          ? [
              {
                grantId: row.id,
                userId: row.principalId,
                kind: "removed" as const,
                occurredAtMs: row.revokedAt.getTime(),
              },
            ]
          : [],
      ),
    ];
    return changes
      .toSorted((left, right) => right.occurredAtMs - left.occurredAtMs)
      .slice(0, limit);
  }

  async offboardUser({
    userId,
    organizationId,
    actor,
    prove,
  }: {
    userId: string;
    organizationId: string;
    actor: LedgerActor;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts> {
    return this.options.database.$transaction(async (tx) => {
      // The membership row goes first: its lock serializes the grant snapshot
      // below with a stamped attach, whose projection now fails its stamp check.
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
      const revokedGrantIds = grantIdRowsSchema
        .parse(
          await tx.grant.findMany({
            where: { organizationId, principalType: "USER", principalId: userId, revokedAt: null },
            select: { id: true },
          }),
        )
        .map((row) => row.id);
      await this.options.writer.offboardMember({
        organizationId,
        userId,
        revokedGrantIds,
        actor,
      });

      // Legacy USER bindings stay only for migration; a departing user's rows
      // would let a later rejoin revive pre-offboard access.
      await tx.roleBinding.deleteMany({ where: { organizationId, userId } });
      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      // Pending invites are keyed by email, not by user id — read the
      // address inside the transaction so the lookup and the delete
      // commit or roll back together.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const email = user?.email ?? null;
      const pendingInvites = email
        ? await tx.organizationInvite.deleteMany({
            where: { organizationId, email, status: "PENDING" },
          })
        : { count: 0 };

      // Direct postcondition: the proof below gates on the membership this
      // transaction just deleted, so on its own it would pass vacuously.
      const remainingGrantHeads = await tx.grant.count({
        where: { organizationId, principalType: "USER", principalId: userId, revokedAt: null },
      });
      if (remainingGrantHeads > 0) {
        throw new OffboardIncompleteError({ userId, organizationId, remainingGrantHeads });
      }

      // The same grants reader runtime authorization uses: the count covers
      // rows, this covers group and organization-level resolution.
      await prove(EventingAuthzReadRepository.create(tx));

      return {
        bindings: revokedGrantIds.length,
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    }, OFFBOARD_MEMBERSHIP_TXN_OPTIONS);
  }
}
