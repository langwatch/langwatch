// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The platform operator's view of directory sync across every customer
 * (ADR-122), and the one write either reconciliation surface has: a retired
 * removal sent through again. An addition is refused by name — a sync fact
 * carries ids and a reason code only, so it has no payload left to resend.
 * specs/identity/scim-reconciliation-surfaces.feature
 */
import {
  DIRECTORY_IDENTITY_PAGE_SIZE,
  ScimApplyNotRedrivableError,
  ScimApplyNotRetiredError,
  type DirectoryIdentityRow,
  type ListOversightSyncsInput,
  type OversightSync,
  type OversightSyncList,
  type RedriveRetiredApplyResult,
} from "@langwatch/enterprise-scim-contract";
import {
  pickRetiredLetter,
  type ScimSyncReadsApi,
  type ScimSyncState,
} from "@langwatch/identity-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { ScimRemovalOperation, ScimSyncLifecycle } from "../app/scim.members.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimDeprovisionService } from "./scim-deprovision.service.ts";

const REDRIVABLE_OPS: readonly string[] = ["delete_user", "deactivate_user"] as const;

function isRedrivable(op: string): op is ScimRemovalOperation {
  return REDRIVABLE_OPS.includes(op);
}

export interface ScimOversightDeps {
  /** Resolved per call: a peer is not callable while the process constructs. */
  syncs: () => Pick<ScimSyncReadsApi, "listForOperator" | "findForOperator">;
  organizations: Pick<OrganizationApi, "findProvisioningSummary">;
  identities: Pick<ScimRepository, "findDirectoryIdentities">;
  lifecycle: Pick<ScimSyncLifecycle, "applyRedriven">;
  deprovision: Pick<ScimDeprovisionService, "removeAccess">;
}

export class ScimOversightService {
  private constructor(private readonly deps: ScimOversightDeps) {}

  static create(deps: ScimOversightDeps): ScimOversightService {
    return new ScimOversightService(deps);
  }

  async list(input: ListOversightSyncsInput): Promise<OversightSyncList> {
    const { syncs, total } = await this.deps.syncs().listForOperator(input);
    const names = await this.organizationNames(syncs.map((sync) => sync.organizationId));

    return {
      syncs: syncs.map((sync) => toOversightSync(sync, names.get(sync.organizationId) ?? null)),
      total,
    };
  }

  async find({ connectionId }: { connectionId: string }): Promise<OversightSync[]> {
    const syncs = await this.deps.syncs().findForOperator({ connectionId });
    const names = await this.organizationNames(syncs.map((sync) => sync.organizationId));

    return syncs.map((sync) => toOversightSync(sync, names.get(sync.organizationId) ?? null));
  }

  findDirectoryIdentities({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<DirectoryIdentityRow[]> {
    return this.deps.identities.findDirectoryIdentities({
      connectionId,
      limit: DIRECTORY_IDENTITY_PAGE_SIZE,
    });
  }

  /**
   * The effect first, the mark second: stamping the letter before the removal
   * ran left a failed removal reading as done, so a second press was told
   * "already done". Repeating a removal is the safe half — it is idempotent.
   */
  async redriveRetiredApply({
    connectionId,
    retiredAtMs,
    operator,
  }: {
    connectionId: string;
    retiredAtMs: number;
    operator: { userId: string };
  }): Promise<RedriveRetiredApplyResult> {
    const [sync] = await this.deps.syncs().findForOperator({ connectionId });
    if (!sync) throw new ScimApplyNotRetiredError({ connectionId });

    const alreadyDriven = sync.deadLetters.some(
      (failure) => failure.retiredAtMs === retiredAtMs && failure.redrivenAtMs !== null,
    );
    if (alreadyDriven) return { applied: false };

    const letter = pickRetiredLetter({ state: sync, retiredAtMs });
    if (!letter) throw new ScimApplyNotRetiredError({ connectionId });
    const { op, userId } = letter;
    if (!isRedrivable(op) || userId === null) throw new ScimApplyNotRedrivableError({ op });

    await this.deps.deprovision.removeAccess({
      userId,
      organizationId: sync.organizationId,
      connectionId: sync.connectionId,
      op,
    });
    await this.deps.lifecycle.applyRedriven({
      organizationId: sync.organizationId,
      connectionId: sync.connectionId,
      retiredAtMs,
      operator,
    });

    return { applied: true };
  }

  private async organizationNames(organizationIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(organizationIds)];
    const summaries = await Promise.all(
      unique.map((organizationId) =>
        this.deps.organizations.findProvisioningSummary(organizationId),
      ),
    );

    return new Map(
      summaries.flatMap((summary) => (summary ? [[summary.id, summary.name] as const] : [])),
    );
  }
}

function toOversightSync(sync: ScimSyncState, organizationName: string | null): OversightSync {
  return {
    connectionId: sync.connectionId,
    organizationId: sync.organizationId,
    organizationName,
    state: sync.state,
    lastPushedAtMs: sync.lastPushedAtMs,
    revokedCause: sync.revokedCause,
    lastFailure: sync.lastFailure,
    deadLetters: sync.deadLetters,
    updatedAtMs: sync.updatedAtMs,
  };
}
