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
import type {
  AuthzGrantsRepository,
  AuthzReadRepository,
  BindingPrincipalWhere,
  GrantWriteActor,
  OffboardCounts,
  RoleBindingWrite,
} from "@langwatch/authz-server";
import {
  BindingMissingError,
  DuplicateBindingError,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  isRecordNotFound,
  isUniqueViolation,
} from "../ledger";
import { PrismaAuthzGrantsRepository } from "./authz-grants.prisma.repository";
import { PrismaAuthzReadRepository } from "./authz-read.prisma.repository";

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
  }: {
    row: RoleBindingWrite;
    actor: GrantWriteActor;
  }): Promise<void> {
    const { organizationId, ...binding } = row;
    await withPortFailures(() =>
      this.writer.attachBindings({
        organizationId,
        bindings: [binding],
        actor,
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
    actor: GrantWriteActor;
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
    actor: GrantWriteActor;
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
    actor: GrantWriteActor;
  }): Promise<void> {
    const revoked = await withPortFailures(() =>
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
    // Nothing to reduce: the broad grant this call narrows is already gone.
    if (revoked === 0) throw new BindingMissingError();
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
    actor: GrantWriteActor;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts> {
    const bindings = await this.db.roleBinding.findMany({
      where: { organizationId, userId },
      select: { id: true },
    });
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
      revokedGrantIds: bindings.map((row) => row.id),
      actor,
    });

    return this.db.$transaction(
      async (tx) => {
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

        // The proof sees the enforced binding deletes (already committed)
        // and this transaction's own membership deletes; a throw rolls the
        // memberships back while the revocations stand — fail-safe.
        await prove(new PrismaAuthzReadRepository(tx));

        return {
          bindings: bindings.length,
          groupMemberships: groupMemberships.count,
          legacyTeamMemberships: legacyTeamMemberships.count,
          pendingInvites: pendingInvites.count,
          organizationMembership: organizationMembership.count > 0,
        };
      },
      { timeout: 15_000 },
    );
  }
}
