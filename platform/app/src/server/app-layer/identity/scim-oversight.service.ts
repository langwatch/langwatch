/**
 * The platform operator's view of directory sync, across every customer
 * (ADR-122), and the one write either reconciliation surface has.
 *
 * It extends the D05 operator surface rather than sitting beside it: the same
 * cross-tenant reach, the same refusal, the same list/search/drawer grammar.
 * What is different underneath is the same thing that is different on the
 * connections surface — the one act it offers is a GUARDED COMMAND with the
 * operator recorded on it, never a field this class writes.
 *
 * THE DEPTH IS THE POINT. An administrator debugging their own directory gets
 * words and counts. An operator holding a support case gets the retired
 * intent, its reason code, how many times it was attempted, and the
 * `externalId <-> userId` mapping that explains why a push matched the wrong
 * nobody — which is exactly the row the organization view will never show.
 *
 * THE RE-DRIVE IS NARROW ON PURPOSE. A directory-sync fact carries ids and a
 * reason code and nothing else (the D01 payload rule), so a failed ADDITION
 * has no payload left to send through again; a removal does, because the
 * person and the organization fully describe it. Everything else is refused
 * by name, with the same remediation the customer is given.
 */
import type { ScimApplyOp, ScimSyncState } from "@langwatch/identity";
import { retiredLetter } from "@langwatch/identity-server";
import {
  ScimApplyNotRedrivableError,
  ScimApplyNotRetiredError,
} from "../../../../ee/scim/errors";
import type { ScimSyncLifecycle } from "../../../../ee/scim/scim-sync.service";
import type {
  DirectoryIdentityRow,
  ScimOversightReadRepository,
} from "./repositories/scim-reconciliation.prisma.repository";

/** How many mapping rows the operator drawer reads at once. */
export const DIRECTORY_IDENTITY_PAGE_SIZE = 100;

/** The removals a retired apply can be sent through again as. */
const REDRIVABLE_OPS: readonly ScimApplyOp[] = [
  "delete_user",
  "deactivate_user",
];

/** One failure as the operator reads it: reason code, attempts and all. */
export interface OversightFailure {
  op: ScimApplyOp;
  /** The stable slug. An operator reads codes; a customer never does. */
  errorCode: string;
  /** How many identical applies failed before this one was recorded. */
  attempts: number;
  retiredAtMs: number | null;
  redrivenAtMs: number | null;
  userId: string | null;
  occurredAtMs: number;
}

/** One connection's sync, on the cross-customer list. */
export interface OversightSync {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  state: string;
  lastPushedAtMs: number | null;
  revokedCause: string | null;
  /** The failure standing right now, if any. */
  lastFailure: OversightFailure | null;
  /** Every apply retired without ever being applied, newest last. */
  deadLetters: OversightFailure[];
  updatedAtMs: number;
}

export interface OversightSyncList {
  syncs: OversightSync[];
  total: number;
}

/** What actually re-runs a removal. `ScimDeprovisionService` satisfies it. */
export interface ScimRedriveApplyPort {
  removeAccess(args: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    op: Extract<ScimApplyOp, "delete_user" | "deactivate_user">;
  }): Promise<unknown>;
}

/** The operator issuing the act, as the surface knows them. */
export interface OperatorActor {
  userId: string;
}

export interface ScimOversightDeps {
  reads: ScimOversightReadRepository;
  /** Composed per call, like every ledger seam: it resolves the pipeline
   *  handle off the App and must not do so at module load. */
  lifecycle: () => ScimSyncLifecycle;
  deprovision: () => ScimRedriveApplyPort;
}

export class ScimOversightService {
  constructor(private readonly deps: ScimOversightDeps) {}

  async getAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<OversightSyncList> {
    const { syncs, total } = await this.deps.reads.findAllSyncs({
      page,
      pageSize,
      search,
    });
    const names = await this.deps.reads.findOrganizationNames({
      organizationIds: syncs.map((sync) => sync.organizationId),
    });
    return {
      syncs: syncs.map((sync) =>
        toOversightSync({
          sync,
          organizationName: names.get(sync.organizationId) ?? null,
        }),
      ),
      total,
    };
  }

  async getById({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<OversightSync | null> {
    const sync = await this.deps.reads.findSyncById({ connectionId });
    if (!sync) return null;
    const names = await this.deps.reads.findOrganizationNames({
      organizationIds: [sync.organizationId],
    });
    return toOversightSync({
      sync,
      organizationName: names.get(sync.organizationId) ?? null,
    });
  }

  /**
   * Which person the directory knows by which identifier, on this
   * connection. Keyed on the connection, never on the identifier alone: the
   * same directory identifier on two connections is two different people, and
   * a lookup that forgot the connection would answer about the wrong one.
   */
  getDirectoryIdentities({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<DirectoryIdentityRow[]> {
    return this.deps.reads.findDirectoryIdentities({
      connectionId,
      limit: DIRECTORY_IDENTITY_PAGE_SIZE,
    });
  }

  /**
   * Send a retired apply through again, once its cause has been fixed.
   *
   * Records the act BEFORE running it, the way every operator act on this
   * family does: an attempt that then failed is exactly what the history
   * exists to hold, and recording afterwards would lose the ones worth
   * having. Re-driving the same dead letter twice applies once, because the
   * first act stamps it and the second finds nothing left to re-drive.
   */
  async redriveRetiredApply({
    connectionId,
    retiredAtMs,
    operator,
  }: {
    connectionId: string;
    retiredAtMs: number;
    operator: OperatorActor;
  }): Promise<{ applied: boolean }> {
    const sync = await this.deps.reads.findSyncById({ connectionId });
    if (!sync) throw new ScimApplyNotRetiredError({ connectionId });

    const alreadyDriven = sync.deadLetters.find(
      (failure) =>
        failure.retiredAtMs === retiredAtMs && failure.redrivenAtMs !== null,
    );
    // Idempotent rather than an error: the operator asked for an operation to
    // have run, and it has. Refusing here would read as "that did not work"
    // about something that did.
    if (alreadyDriven) return { applied: false };

    const letter = retiredLetter({ state: sync, retiredAtMs });
    if (!letter) throw new ScimApplyNotRetiredError({ connectionId });
    if (!REDRIVABLE_OPS.includes(letter.op) || letter.userId === null) {
      throw new ScimApplyNotRedrivableError({ op: letter.op });
    }

    await this.deps.lifecycle().applyRedriven({
      organizationId: sync.organizationId,
      connectionId: sync.connectionId,
      retiredAtMs,
      operator,
    });
    await this.deps.deprovision().removeAccess({
      userId: letter.userId,
      organizationId: sync.organizationId,
      connectionId: sync.connectionId,
      op: letter.op as Extract<ScimApplyOp, "delete_user" | "deactivate_user">,
    });
    return { applied: true };
  }
}

function toOversightSync({
  sync,
  organizationName,
}: {
  sync: ScimSyncState;
  organizationName: string | null;
}): OversightSync {
  return {
    connectionId: sync.connectionId,
    organizationId: sync.organizationId,
    organizationName,
    state: sync.state,
    lastPushedAtMs: sync.lastPushedAtMs,
    revokedCause: sync.revokedCause,
    lastFailure: sync.lastFailure ?? null,
    deadLetters: sync.deadLetters,
    updatedAtMs: sync.updatedAtMs,
  };
}
