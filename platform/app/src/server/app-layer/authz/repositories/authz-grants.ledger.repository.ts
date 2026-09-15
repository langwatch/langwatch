/**
 * ADR-092 §13 — the ledger-backed implementation of AuthzGrantsRepository:
 * the write port's storage engine is command emission. Reads (tenancy
 * lookups, manifests) delegate to `PrismaAuthzGrantsRepository`; every write
 * appends to the grants ledger through `GrantsLedgerWriter`, which owns
 * read-your-writes convergence, instant revocation enforcement (decision 7),
 * and the epoch bump (decision 19).
 *
 * Atomicity: `replaceBinding` is a revoke command then an attach command in
 * per-org FIFO — a crash between the two leaves the principal with LESS
 * access than asked, never more (fail-safe by construction), and the retry
 * attaches cleanly. `offboardUser` appends the offboarding fact FIRST (the
 * ledger is the truth — a direct delete without its event would be
 * resurrected by the next fold), enforces the grant deletes synchronously,
 * then removes the membership rows and runs the proof in one transaction. A
 * proof failure rolls back the membership deletes but the revocations stand
 * — again the fail-safe direction — and the retry converges.
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
import { PrismaAuthzGrantsRepository } from "./authz-grants.prisma.repository";
import { CutoverAwareAuthzReadRepository } from "./authz-read.cutover.repository";

/**
 * The port's two typed failures, restored on the way out.
 *
 * Writes travel through the ledger writer, which owns a legacy path (raw
 * Prisma), a ledger path, and a synchronous enforcement write; a duplicate
 * or missing-row signal can surface from any of them. The port documents
 * `@throws DuplicateBindingError` / `@throws BindingMissingError`, and
 * GrantsService turns exactly those two into the customer's 409 and 404 —
 * anything that reaches it as a raw `PrismaClientKnownRequestError` degrades
 * to an unknown 500 instead, which is a silently broken REST contract
 * rather than a visible bug.
 *
 * Everything else passes through untouched: an infra failure has no action
 * for the caller and must degrade to "unknown" with its trace id.
 */
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

/**
 * `offboardUser`'s membership-deletion transaction runs `prove` — a read
 * repository resolution through the transaction's own client — while still
 * holding whatever row locks the deletes took, so it needs the same explicit
 * budget every other multi-statement `$transaction` in this codebase sets
 * rather than Prisma's 5s default (see `dataset-lock.ts`,
 * `modelDefaults.service.ts`, `prismaProcessStore.ts`): `timeout` bounds the
 * callback itself, `maxWait` bounds acquiring a connection from the pool
 * before it even starts.
 */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

export class LedgerAuthzGrantsRepository implements AuthzGrantsRepository {
  private readonly reads: PrismaAuthzGrantsRepository;

  constructor(
    private readonly db: PrismaClient,
    private readonly writer: GrantsLedgerWriter,
  ) {
    this.reads = new PrismaAuthzGrantsRepository(db);
  }

  findBinding(
    ...args: Parameters<PrismaAuthzGrantsRepository["findBinding"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findBinding"]> {
    return this.reads.findBinding(...args);
  }

  findCustomRole(
    ...args: Parameters<PrismaAuthzGrantsRepository["findCustomRole"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findCustomRole"]> {
    return this.reads.findCustomRole(...args);
  }

  findTeamOrganization(
    ...args: Parameters<PrismaAuthzGrantsRepository["findTeamOrganization"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findTeamOrganization"]> {
    return this.reads.findTeamOrganization(...args);
  }

  findProjectLineage(
    ...args: Parameters<PrismaAuthzGrantsRepository["findProjectLineage"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findProjectLineage"]> {
    return this.reads.findProjectLineage(...args);
  }

  findOwnedApiKeys(
    ...args: Parameters<PrismaAuthzGrantsRepository["findOwnedApiKeys"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findOwnedApiKeys"]> {
    return this.reads.findOwnedApiKeys(...args);
  }

  findPersonalTeams(
    ...args: Parameters<PrismaAuthzGrantsRepository["findPersonalTeams"]>
  ): ReturnType<PrismaAuthzGrantsRepository["findPersonalTeams"]> {
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
    // The compat head is not the whole head any more (delivery-plan PR 3). A
    // cut-over organization carries user facts `RoleBinding` cannot express —
    // the lite-member rows the cutover imports, the zero-binding-admin facts
    // genesis wrote — and enumerating only compat rows would leave every one
    // of them resolving for a user who has just been offboarded. So the
    // revoked set is the UNION: the compat ids, plus every Grant-head row this
    // organization holds for this user as a principal.
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

    // Group memberships end the same way, and for the same reason they cannot
    // stay in the transaction below: a command is not enrollable in a Prisma
    // transaction. The sweep used to `deleteMany` them, which is exactly the
    // hole ADR-125 named — the audit stream remembered the departure, the
    // state did not, and the answer to "which groups was Dave in when he
    // left" was gone.
    //
    // Before the transaction, like the revocations above and with the same
    // fail-safe consequence: if the proof throws, the organization and team
    // membership deletes roll back while these removals stand. That
    // under-grants, a retry converges, and every read of live membership is
    // fenced — so the proof inside the transaction sees them as gone whether
    // or not the fold has run yet.
    const removedMembershipIds = await this.writer.removeGroupMembersWhere({
      organizationId,
      where: { userId },
      actor,
      reason: "offboarded from organization",
      bypass: "offboard",
    });

    return this.db.$transaction(async (tx) => {
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
      // It reads through the CUTOVER-AWARE repository, not the legacy one:
      // "nothing resolves any more" has to be proven against the head this
      // organization is actually served from, or a cut-over organization's
      // offboarding would prove the wrong thing about the wrong table. The
      // direct count above is what keeps it honest about the rows; this
      // keeps it honest about RESOLUTION - group- and org-floor paths the
      // row count cannot see.
      await prove(new CutoverAwareAuthzReadRepository(tx));

      return {
        bindings: bindings.length,
        groupMemberships: removedMembershipIds.length,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    }, OFFBOARD_MEMBERSHIP_TXN_OPTIONS);
  }
}
