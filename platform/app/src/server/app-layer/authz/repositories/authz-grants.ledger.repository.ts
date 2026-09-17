/**
 * Reads tenancy and writes through the grants ledger. Replacement revokes
 * before attaching; offboarding revokes before its membership transaction.
 * A crash or failed postcondition therefore leaves less access, and retries converge.
 */
import type { LedgerActor } from "@langwatch/actor";
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
  OffboardIncompleteError,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  isRecordNotFound,
  isUniqueViolation,
} from "../ledger";
import { GrantsAuthzReadRepository } from "./authz-read.grants.repository";

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

/** Bound both connection acquisition and the transactional offboarding proof. */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

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
    return this.db.roleBinding.findUnique({
      where: { id: bindingId },
      select: { id: true, organizationId: true },
    });
  }

  async findCustomRole({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    return this.db.customRole.findUnique({
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
      where: { organizationId, isPersonal: true, ownerUserId: userId },
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
    const existing = await this.db.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
      select: { id: true },
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
    // Existence has to be established BEFORE anything is appended.
    // `revokeBindingsWhere`'s returned count is advisory — a lagging compat
    // projection can read 0 while the broad grant it is meant to narrow
    // landed moments ago and is genuinely there (its own docstring says so).
    // Deriving "missing" from that count AFTER the revoke has already
    // appended used to mean: a selector-only `grant_revoked` sweeps the
    // grant away once the fold catches up, while the caller is told nothing
    // was there to replace — a replace that nets to zero access instead of
    // narrowing it. This pre-read can still see stale-empty under the same
    // fold lag, but that failure mode is safe: nothing has been appended
    // yet, so the caller can retry with its access intact.
    const existing = await this.db.roleBinding.findFirst({
      where: {
        organizationId: deleteWhere.organizationId,
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        ...deleteWhere.principal,
      },
      select: { id: true },
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
    const bindings = await this.db.roleBinding.findMany({
      where: { organizationId, userId },
      select: { id: true },
    });
    // The compatibility head does not carry every grant fact. The revoked set
    // is therefore the union of compatibility ids and every Grant-head row
    // this organization holds for the user.
    //
    // The rows expressible both ways are counted once and revoked once:
    // instant enforcement deletes by grant id, and the compat row SHARES that
    // id by construction, so one revocation takes out both heads. That is also
    // why the proof below means the same thing whichever head it reads.
    const grantHeads = await this.db.grant.findMany({
      where: { organizationId, principalType: "USER", principalId: userId },
      select: { id: true },
    });
    const revokedGrantIds = [
      ...new Set([
        ...bindings.map((row) => row.id),
        ...grantHeads.map((row) => row.id),
      ]),
    ];
    // The fact first (the ledger is the truth), enforcement with it — the
    // deny holds before the membership rows move.
    //
    // The id list is what the compat projection could see, which is a fold
    // behind the ledger; it is the audit record and the count this call
    // answers with, NOT the instruction. The fold removes every grant the
    // principal holds (the reducer's `member_offboarded` sweep), so a grant
    // appended between this query and the append cannot outlive the
    // departure.
    await this.writer.offboardMember({
      organizationId,
      userId,
      revokedGrantIds,
      actor,
    });

    return this.db.$transaction(async (tx) => {
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

      // The proof sees the enforced binding deletes (already committed)
      // and this transaction's own membership deletes; a throw rolls the
      // memberships back while the revocations stand — fail-safe.
      //
      // Prove through the same grants reader used by runtime authorization;
      // the direct counts above cover rows while this covers group and
      // organization-level resolution.
      await prove(new GrantsAuthzReadRepository(tx));

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
