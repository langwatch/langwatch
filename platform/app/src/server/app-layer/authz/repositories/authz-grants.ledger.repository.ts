/**
 * ADR-092 §13 (delivery plan PR 2) — the ledger-backed implementation of
 * AuthzGrantsRepository: the write port's storage engine is now command
 * emission. Reads (tenancy lookups, manifests) stay the Prisma queries of
 * the parent class; every write appends to the grants ledger through
 * `GrantsLedgerWriter`, which owns read-your-writes convergence, instant
 * revocation enforcement (decision 7), and the epoch bump (decision 19).
 *
 * Atomicity note, replacing the parent's transactions: `replaceBinding`
 * is a revoke command then an attach command in per-org FIFO — a crash
 * between the two leaves the principal with LESS access than asked, never
 * more (fail-safe by construction), and the retry attaches cleanly.
 * `offboardUser` appends the offboarding fact FIRST (the ledger is the
 * truth — a direct delete without its event would be resurrected by the
 * next fold), enforces the grant deletes synchronously, then removes the
 * membership rows and runs the proof in one transaction. A proof failure
 * rolls back the membership deletes but the revocations stand — again the
 * fail-safe direction — and the retry converges.
 */
import type {
  AuthzReadRepository,
  BindingPrincipalWhere,
  GrantWriteActor,
  OffboardCounts,
  RoleBindingWrite,
} from "@langwatch/authz-server";
import { BindingMissingError } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "../ledger";
import { PrismaAuthzGrantsRepository } from "./authz-grants.prisma.repository";
import { PrismaAuthzReadRepository } from "./authz-read.prisma.repository";

export class LedgerAuthzGrantsRepository extends PrismaAuthzGrantsRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly writer: GrantsLedgerWriter,
  ) {
    super(db);
  }

  override async createBinding(
    row: RoleBindingWrite,
    context: { actor: GrantWriteActor },
  ): Promise<void> {
    const { organizationId, ...binding } = row;
    await this.writer.attachBindings({
      organizationId,
      bindings: [binding],
      actor: context.actor,
      onDuplicate: "reject",
    });
  }

  override async updateBindingRole({
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
    await this.writer.changeBindingRole({
      organizationId,
      bindingId,
      role,
      customRoleId,
      actor,
    });
  }

  override async deleteBinding({
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
    await this.writer.revokeBindings({
      organizationId,
      bindingIds: [bindingId],
      actor,
    });
  }

  override async replaceBinding({
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
    const revoked = await this.writer.revokeBindingsWhere({
      organizationId: deleteWhere.organizationId,
      where: {
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        ...deleteWhere.principal,
      },
      actor,
      reason: "replaced by a narrower grant",
    });
    // Nothing to reduce: the broad grant this call narrows is already gone.
    if (revoked === 0) throw new BindingMissingError();
    const { organizationId, ...binding } = create;
    await this.writer.attachBindings({
      organizationId,
      bindings: [binding],
      actor,
      onDuplicate: "reject",
    });
  }

  override async offboardUser({
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
