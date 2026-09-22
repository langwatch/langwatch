/**
 * Ledger-backed AuthzGrantsRepository: writes emit commands; reads delegate to
 * Prisma. Fail-safe atomicity through per-org FIFO (ADR-092 §13).
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  BindingMissingError,
  DuplicateBindingError,
  type GrantEventSource,
  OffboardIncompleteError,
  type OffboardCounts,
} from "@langwatch/authz-contract";

import {
  AuthzLedgerMapper,
  type EventingAuthzLedgerAdapter,
} from "../../eventing/authz-grant.store.ts";
import {
  AuthzGrantRepository,
  type BindingPrincipalWhere,
  type DirectoryCausedGrantChange,
  type RoleBindingWrite,
} from "../authz-grant.repository.ts";
import type {
  AuthzDatabase,
  AuthzReadHeadSelector,
  AuthzReadRepository,
} from "../authz-read.repository.ts";
import { PrismaAuthzGrantRepository } from "../prisma/prisma.authz-grant.repository.ts";
import { RoutedAuthzReadRepository } from "../routed/routed.authz-read.repository.ts";

/**
 * Restore the port's two typed failures (DuplicateBindingError,
 * BindingMissingError) from any ledger write path; everything else passes.
 */
class AuthzGrantPortFailureMapper {
  /** Run a write, and let only the port's own vocabulary out of it. */
  static async run<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      this.rethrow(error);
    }
  }

  private static rethrow(error: unknown): never {
    if (error instanceof DuplicateBindingError || error instanceof BindingMissingError) {
      throw error;
    }
    if (AuthzLedgerMapper.isUniqueViolation(error)) {
      throw new DuplicateBindingError();
    }
    if (AuthzLedgerMapper.isRecordNotFound(error)) {
      throw new BindingMissingError();
    }
    throw error;
  }
}

/**
 * Membership-deletion transaction needs explicit budget (timeout + maxWait)
 * because prove holds row locks while reading.
 */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

type WriteDelegate = {
  findFirst(args: unknown): Promise<any>;
  findMany(args: unknown): Promise<any[]>;
  count(args: unknown): Promise<number>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  findUnique(args: unknown): Promise<any>;
};

export type AuthzGrantWriteDatabase = Omit<
  AuthzDatabase,
  "roleBinding" | "grant" | "groupMembership" | "teamUser" | "organizationUser" | "user"
> & {
  roleBinding: WriteDelegate;
  grant: WriteDelegate;
  groupMembership: WriteDelegate;
  teamUser: WriteDelegate;
  organizationUser: WriteDelegate;
  organizationInvite: WriteDelegate;
  user: WriteDelegate;
  $transaction<T>(
    write: (transaction: AuthzGrantWriteDatabase) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ): Promise<T>;
};

export type EventingAuthzGrantRepositoryOptions = {
  database: AuthzGrantWriteDatabase;
  writer: EventingAuthzLedgerAdapter;
  selectHead: AuthzReadHeadSelector;
};

export class EventingAuthzGrantRepository extends AuthzGrantRepository {
  private readonly reads: PrismaAuthzGrantRepository;

  static create(options: EventingAuthzGrantRepositoryOptions): EventingAuthzGrantRepository {
    return new EventingAuthzGrantRepository(options);
  }

  private constructor(private readonly options: EventingAuthzGrantRepositoryOptions) {
    super();
    this.reads = PrismaAuthzGrantRepository.create(options.database);
  }

  findBinding(
    ...args: Parameters<PrismaAuthzGrantRepository["findBinding"]>
  ): ReturnType<PrismaAuthzGrantRepository["findBinding"]> {
    return this.reads.findBinding(...args);
  }

  findCustomRole(
    ...args: Parameters<PrismaAuthzGrantRepository["findCustomRole"]>
  ): ReturnType<PrismaAuthzGrantRepository["findCustomRole"]> {
    return this.reads.findCustomRole(...args);
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
    await AuthzGrantPortFailureMapper.run(() =>
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
    await AuthzGrantPortFailureMapper.run(() =>
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
    const existing = await this.options.database.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new BindingMissingError();
    await AuthzGrantPortFailureMapper.run(() =>
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
    // Pre-read existence before appending to avoid false "missing" from
    // lagging compat projection; safe failure mode keeps access intact.
    const existing = await this.options.database.roleBinding.findFirst({
      where: {
        organizationId: deleteWhere.organizationId,
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        ...deleteWhere.principal,
      },
      select: { id: true },
    });
    if (!existing) throw new BindingMissingError();

    await AuthzGrantPortFailureMapper.run(() =>
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
    await AuthzGrantPortFailureMapper.run(() =>
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
    const bindings = await this.options.database.roleBinding.findMany({
      where: { organizationId, userId },
      select: { id: true },
    });
    // Compat head is incomplete: cut-over orgs carry facts RoleBinding cannot
    // express. Revoke the UNION (compat ids + Grant-head rows).
    const grantHeads = await this.options.database.grant.findMany({
      where: { organizationId, principalType: "USER", principalId: userId },
      select: { id: true },
    });
    const revokedGrantIds = [
      ...new Set([...bindings.map((row) => row.id), ...grantHeads.map((row) => row.id)]),
    ];
    // Append fact first (ledger is truth); fold removes every grant so
    // mid-flight appends cannot outlive the departure.
    await this.options.writer.offboardMember({
      organizationId,
      userId,
      revokedGrantIds,
      actor,
    });

    return this.options.database.$transaction(async (tx) => {
      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
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

      // Direct postcondition: no grant source keyed to this user remains on
      // either head. User-read gates on membership (just deleted), so count
      // failing gates the retry (fail-safe).
      const [remainingGrantHeads, remainingCompatRows] = await Promise.all([
        tx.grant.count({
          where: {
            organizationId,
            principalType: "USER",
            principalId: userId,
            // A revoke MARKS its row now. Without this the check counts the
            // rows the revocation just ended, so a departing member who held
            // any grant at all fails their own offboarding and the membership
            // deletes roll back — the postcondition inverted by the very
            // change that was supposed to satisfy it.
            revokedAt: null,
          },
        }),
        tx.roleBinding.count({ where: { organizationId, userId } }),
      ]);
      if (remainingGrantHeads > 0 || remainingCompatRows > 0) {
        throw new OffboardIncompleteError({
          userId,
          organizationId,
          remainingGrantHeads,
          remainingCompatRows,
        });
      }

      // Proof through cutover-aware repository: direct count catches rows,
      // proof catches resolution paths (group/org floors) (fail-safe).
      await prove(
        RoutedAuthzReadRepository.create({
          database: tx,
          selectHead: this.options.selectHead,
        }),
      );

      return {
        bindings: bindings.length,
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    }, OFFBOARD_MEMBERSHIP_TXN_OPTIONS);
  }
}
