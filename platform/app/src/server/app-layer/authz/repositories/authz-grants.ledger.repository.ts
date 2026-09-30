/**
 * Reads tenancy and writes through the grants ledger. Replacement revokes
 * before attaching; offboarding revokes before its membership transaction.
 * A crash or failed postcondition therefore leaves less access, and retries converge.
 */
import type { LedgerActor } from "@langwatch/actor";
import { STORED_PRINCIPAL_KIND } from "@langwatch/authz";
import type {
  AuthzGrantsRepository,
  AuthzReadRepository,
  BindingPrincipalWhere,
  GrantEventSource,
  OffboardCounts,
  RoleBindingWrite,
} from "@langwatch/authz-server";
import {
  BindingMissingError,
  DuplicateBindingError,
  grantRowToFact,
  isBindingGrant,
  OffboardIncompleteError,
} from "@langwatch/authz-server";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { lockActiveAdmins } from "~/server/app-layer/organizations/active-admin-lock";
import {
  CannotRemoveLastAdminError,
  MemberNotFoundError,
} from "~/server/app-layer/organizations/errors";
import {
  type GrantsLedgerWriter,
  isRecordNotFound,
  isUniqueViolation,
  principalForWhere,
} from "../ledger";
import { GrantsAccessListingRepository } from "./access-listing.grants.repository";
import { GrantsAuthzReadRepository } from "./authz-read.grants.repository";
import { liveGrants, liveRoles } from "./live-rows";

/** Preserve the service's 409/404 contract across ledger and Prisma failures. */
function rethrowAsPortFailure(error: unknown): never {
  if (
    error instanceof DuplicateBindingError ||
    error instanceof BindingMissingError
  ) {
    throw error;
  }
  if (isUniqueViolation(error)) throw new DuplicateBindingError();
  if (isRecordNotFound(error)) throw new BindingMissingError();
  throw error;
}

/** Run a write, and let only the port's own vocabulary out of it. */
async function withPortFailures<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    rethrowAsPortFailure(error);
  }
}

async function grantIdsForOffboard({
  tx,
  userId,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  organizationId: string;
}): Promise<{ ids: string[]; count: number }> {
  const grantHeads = await tx.grant.findMany({
    where: {
      organizationId,
      principalType: "USER",
      principalId: userId,
      revokedAt: null,
    },
    select: { id: true },
  });
  return { ids: grantHeads.map((row) => row.id), count: grantHeads.length };
}

async function assertOffboardKeepsActiveAdmin({
  tx,
  userId,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const activeAdmins = await lockActiveAdmins({ tx, organizationId });
  if (activeAdmins.length === 1 && activeAdmins[0]?.userId === userId) {
    throw new CannotRemoveLastAdminError();
  }
}

async function archivePersonalWorkspaces({
  tx,
  organizationId,
  userId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const personalTeams = await tx.team.findMany({
    where: {
      organizationId,
      ownerUserId: userId,
      isPersonal: true,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (personalTeams.length === 0) return;

  const archivedAt = new Date();
  const personalTeamIds = personalTeams.map(({ id }) => id);
  await tx.project.updateMany({
    where: {
      teamId: { in: personalTeamIds },
      isPersonal: true,
      archivedAt: null,
    },
    data: { archivedAt },
  });
  await tx.team.updateMany({
    where: { id: { in: personalTeamIds } },
    data: { archivedAt },
  });
}

/** Bound both connection acquisition and the transactional offboarding proof. */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

function grantWhereForPrincipal(
  principal: BindingPrincipalWhere,
): Pick<Prisma.GrantWhereInput, "principalType" | "principalId"> {
  const canonical = principalForWhere(principal);
  return {
    principalType: STORED_PRINCIPAL_KIND[canonical.type],
    principalId: canonical.id,
  };
}

export class LedgerAuthzGrantsRepository implements AuthzGrantsRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly writer: GrantsLedgerWriter,
  ) {}

  async findBinding({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null> {
    const row = await liveGrants(this.db).findFirst({
      where: { id: bindingId },
    });
    if (!row || !isBindingGrant(grantRowToFact(row))) return null;
    return { id: row.id, organizationId: row.organizationId };
  }

  async findCustomRole({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    return liveRoles(this.db).findFirst({
      where: { id: customRoleId },
      select: { organizationId: true, permissions: true },
    });
  }

  async findTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.db.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async findProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    });
    if (!project?.team) return null;
    return {
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }

  async findOwnedApiKeys({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.db.apiKey.findMany({
      where: { userId, organizationId, revokedAt: null },
      select: { id: true, name: true },
    });
  }

  async findPersonalTeams({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.db.team.findMany({
      where: {
        organizationId,
        isPersonal: true,
        ownerUserId: userId,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
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
    await withPortFailures(() =>
      this.writer.attachBindings({
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
    await withPortFailures(() =>
      this.writer.changeBindingRole({
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
    const [existing] = await new GrantsAccessListingRepository(
      this.db,
    ).findBindingRows({
      organizationId,
      where: { id: bindingId },
    });
    if (!existing) throw new BindingMissingError();
    await withPortFailures(() =>
      this.writer.revokeBindings({
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
    const [existing] = await new GrantsAccessListingRepository(
      this.db,
    ).findBindingRows({
      organizationId: deleteWhere.organizationId,
      where: {
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        ...grantWhereForPrincipal(deleteWhere.principal),
      },
    });
    if (!existing) throw new BindingMissingError();

    await withPortFailures(() =>
      this.writer.revokeBindingsWhere({
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
    await withPortFailures(() =>
      this.writer.attachBindings({
        organizationId,
        bindings: [binding],
        actor,
        onDuplicate: "reject",
      }),
    );
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
    return this.db.$transaction(async (tx) => {
      await assertOffboardKeepsActiveAdmin({ tx, userId, organizationId });

      // Serialize the grant snapshot with a delayed stamped USER attach. A
      // projection that already validated this membership commits before we
      // can acquire the row lock and is therefore included in the snapshot;
      // one that has not acquired it yet waits until this delete commits and
      // then fails its stamp check.
      const membership = await tx.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId"
        FROM "OrganizationUser"
        WHERE "organizationId" = ${organizationId}
          AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (membership.length === 0) {
        await this.writer.revokeBindingsWhere({
          organizationId,
          where: { userId },
          actor,
          reason: "organization membership removed",
        });
        throw new MemberNotFoundError(userId);
      }
      const { ids: revokedGrantIds, count: bindingCount } =
        await grantIdsForOffboard({ tx, userId, organizationId });

      // The fact and its deny enforcement happen while the organization lock
      // is held, before the membership rows move in this transaction.
      await this.writer.offboardMember({
        organizationId,
        userId,
        revokedGrantIds,
        actor,
      });

      // Legacy USER bindings are retained for migration compatibility, but
      // retaining a departing user's rows would let a later rejoin revive
      // pre-offboard access. The delete is in this transaction, so a failed
      // offboard rolls it back with the membership removal.
      await tx.roleBinding.deleteMany({
        where: { organizationId, userId },
      });

      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
      await archivePersonalWorkspaces({ tx, organizationId, userId });
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

      // The DIRECT postcondition, before the collector-shaped proof: no
      // grant source keyed to this user's principal may remain on either
      // head. The proof below re-collects through the reader the request
      // path uses, and both heads' user reads GATE ON MEMBERSHIP - which
      // this very transaction has just deleted - so on its own it passes
      // vacuously whether or not the revocations actually landed. This
      // count does not gate: surviving Grant or RoleBinding rows would
      // resolve again the moment the user is re-invited, so they fail the
      // offboarding here, rolling the membership deletes back while the
      // revocation facts stand (fail-safe: the retry converges).
      const remainingGrantHeads = await tx.grant.count({
        where: {
          organizationId,
          principalType: "USER",
          principalId: userId,
          revokedAt: null,
        },
      });
      if (remainingGrantHeads > 0) {
        throw new OffboardIncompleteError({
          userId,
          organizationId,
          remainingGrantHeads,
        });
      }

      // The proof sees the enforced binding deletes (already committed)
      // and this transaction's own membership deletes; a throw rolls the
      // memberships back while the revocations stand — fail-safe.
      //
      // Prove through the same grants reader used by runtime authorization;
      // the direct counts above cover rows while this covers group and
      // organization-level resolution.
      await prove(new GrantsAuthzReadRepository(tx));

      return {
        bindings: bindingCount,
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    }, OFFBOARD_MEMBERSHIP_TXN_OPTIONS);
  }
}
