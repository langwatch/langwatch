/**
 * Ledger-backed AuthzGrantsRepository: writes emit commands; binding and role
 * reads use the live grant and role heads. Fail-safe atomicity through per-org
 * FIFO (ADR-092 §13).
 */
import type { LedgerActor } from "@langwatch/authorization";
import {
  BindingMissingError,
  DuplicateBindingError,
  type GrantEventSource,
  type OffboardCounts,
} from "@langwatch/authz-contract";

import type { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import {
  AuthzGrantRepository,
  type BindingPrincipalWhere,
  type DirectoryCausedGrantChange,
  type GrantWrite,
} from "../authz-grant.repository.ts";
import type { AuthzLedgerReadRepository } from "../authz-ledger-read.repository.ts";
import type { AuthzReadRepository, ScopeLineageRepository } from "../authz-read.repository.ts";
import {
  compatBindingFromGrantFact,
  grantRowToFact,
  PRINCIPAL_TO_DB,
} from "../prisma/prisma.authz-grant.mapper.ts";
import {
  isRecordNotFound,
  isUniqueViolation,
  principalForWhere,
} from "../prisma/prisma.authz-ledger.mapper.ts";

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

type EventingAuthzGrantRepositoryOptions = {
  /** The live Grant and Role heads, the directory's grants and the offboarding transaction. */
  reads: AuthzLedgerReadRepository;
  /** Which team and organization a scope sits in: the decision reads' own lineage. */
  lineage: Pick<ScopeLineageRepository, "findTeamOrganization" | "findProjectLineage">;
  writer: Pick<
    EventingAuthzLedgerAdapter,
    | "attachBindings"
    | "changeBindingRole"
    | "revokeBindings"
    | "revokeBindingsWhere"
    | "offboardMember"
  >;
};

export class EventingAuthzGrantRepository extends AuthzGrantRepository {
  static create(options: EventingAuthzGrantRepositoryOptions): EventingAuthzGrantRepository {
    return new EventingAuthzGrantRepository(options);
  }

  private constructor(private readonly options: EventingAuthzGrantRepositoryOptions) {
    super();
  }

  /** A live grant a role binding can express, or null. */
  async findBinding({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null> {
    const row = await this.options.reads.findLiveGrant({ grantId: bindingId });
    if (row === null) return null;
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
    return this.options.reads.findLiveCustomRole({ roleId: customRoleId });
  }

  // Arrow instance properties, matching the base class's property-typed
  // abstract members (ScopeLineageRepository declares them that way for
  // test mocks).
  findTeamOrganization: ScopeLineageRepository["findTeamOrganization"] = (input) =>
    this.options.lineage.findTeamOrganization(input);

  findProjectLineage: ScopeLineageRepository["findProjectLineage"] = (input) =>
    this.options.lineage.findProjectLineage(input);

  findOwnedApiKeys(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.options.reads.findOwnedApiKeys(input);
  }

  findPersonalTeams(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.options.reads.findPersonalTeams(input);
  }

  /** An identical binding at this scope is written too: bindings are never unique. */
  async createBinding({
    row,
    actor,
    source,
  }: {
    row: GrantWrite;
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
        onDuplicate: "attach",
      }),
    );
  }

  /** @throws BindingMissingError when the row is gone. */
  async updateBindingRole({
    bindingId,
    organizationId,
    role,
    customRoleId,
    actor,
  }: {
    bindingId: string;
    organizationId: string;
    role: GrantWrite["role"];
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

  /** @throws BindingMissingError when the delete matched nothing. */
  async replaceBinding({
    deleteWhere,
    create,
    actor,
  }: {
    deleteWhere: {
      organizationId: string;
      scopeType: GrantWrite["scopeType"];
      scopeId: string;
      principal: BindingPrincipalWhere;
    };
    create: GrantWrite;
    actor: LedgerActor;
  }): Promise<void> {
    // Refuse before emitting writes when the original grant is absent. A
    // lagging projection can report it absent; retry leaves access unchanged.
    const principal = principalForWhere(deleteWhere.principal);
    const existing = await this.options.reads.findLiveGrantIds({
      where: {
        organizationId: deleteWhere.organizationId,
        scopeType: deleteWhere.scopeType,
        scopeId: deleteWhere.scopeId,
        principalType: PRINCIPAL_TO_DB[principal.type],
        principalId: principal.id,
      },
    });
    if (existing.length === 0) throw new BindingMissingError();

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
        onDuplicate: "attach",
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
    return this.options.reads.findDirectoryGrantIds({ organizationId, userIds });
  }

  async findDirectoryCausedChanges({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<DirectoryCausedGrantChange[]> {
    // Two reads because they are two orderings: a grant written last year and
    // taken back this morning is the most recent REMOVAL and one of the
    // oldest attachments, and one `orderBy` cannot say both.
    const { attached, removed } = await this.options.reads.findDirectoryGrantHistory({
      organizationId,
      limit,
    });

    // One row per grant, as on main: a revoked grant reads as removed, at the later time.
    const rows = [...new Map([...attached, ...removed].map((row) => [row.id, row])).values()];
    return rows
      .map((row) => ({
        grantId: row.id,
        userId: row.principalId,
        kind: row.revokedAt ? ("removed" as const) : ("attached" as const),
        occurredAtMs: Math.max(
          row.createdAt.epochMilliseconds,
          row.revokedAt?.epochMilliseconds ?? 0,
        ),
      }))
      .toSorted(
        (left, right) =>
          right.occurredAtMs - left.occurredAtMs || left.grantId.localeCompare(right.grantId),
      )
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
    let revokedGrantIds: string[] = [];
    const counts = await this.options.reads.offboardUser({
      userId,
      organizationId,
      revoke: async (grantIds) => {
        revokedGrantIds = grantIds;
        await this.options.writer.offboardMember({
          organizationId,
          userId,
          revokedGrantIds: grantIds,
          actor,
        });
      },
      // The same grants reader runtime authorization uses: the count covers
      // rows, this covers group and organization-level resolution.
      prove,
    });
    return { bindings: revokedGrantIds.length, ...counts };
  }
}
