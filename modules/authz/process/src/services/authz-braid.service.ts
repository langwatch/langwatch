import type { GrantCondition, LedgerActor } from "@langwatch/authorization";
import {
  BraidAcrossOrganizationsError,
  BraidAggregateProjectError,
  BraidAlreadyExistsError,
  BraidChangedError,
  BraidConditionRefusedError,
  BraidGovernanceProjectError,
  BraidIntoItselfError,
  BraidNotOnProjectError,
  GrantExceedsCallerPermissionsError,
  GrantExpiryInPastError,
  GrantValidationError,
  type AuthzBraid,
  type AuthzBraidRemoved,
  type AuthzChangeBraidInput,
  type AuthzCreateBraidInput,
  type AuthzListBraidsInput,
  type AuthzOrganizationBraids,
  type AuthzOrganizationInput,
  type AuthzPrincipalRef,
  type AuthzProjectBraids,
  type AuthzRemoveBraidInput,
} from "@langwatch/authz-contract";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { Temporal } from "@langwatch/time";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type { AuthzBraidLockRepository } from "../repositories/authz-braid-lock.repository.ts";
import type { LedgerBraidRow } from "../repositories/authz-ledger-read.repository.ts";
import type { ScopeLineageRepository } from "../repositories/authz-read.repository.ts";
import {
  assertWithinConditionLimit,
  braidKey,
  braidOf,
  keyOf,
  withoutReplaced,
  type BraidRequest,
  type BraidTerms,
} from "../rules/authz-braid.rules.ts";
import {
  AuthzBraidWriteService,
  type AuthzBraidWriteDependencies,
} from "./authz-braid-write.service.ts";
import type { AuthzGrantWriterPermissions } from "./authz-grant-writer.service.ts";

/** What a braid confers on the owner: a span window opens span reads alone (ADR-201 §1, v4.9). */
const BRAID_CONFERRED_PERMISSIONS = ["traces:view"] as const;
export const BRAID_REMOVED_REASON = "braid_removed";
export const BRAID_CHANGED_REASON = "braid_changed";

type AuthzBraidDependencies = AuthzBraidWriteDependencies & {
  ledger: Pick<EventingAuthzLedgerAdapter, "revokeBindings">;
  lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
  locks: AuthzBraidLockRepository;
  permissions: Pick<AuthzGrantWriterPermissions, "findPermissionsBeyondCaller">;
};

/**
 * ADR-201 §1-§2: a braid is a shared span grant from the owner project to the reader project.
 * The door asked the permissions; this service checks what needs the loaded rows: the projects,
 * the caller's ceiling on the owner, the condition, and the reader's live braids under its lock.
 */
export class AuthzBraidService {
  static create(deps: AuthzBraidDependencies): AuthzBraidService {
    return new AuthzBraidService(deps, AuthzBraidWriteService.create(deps));
  }

  private constructor(
    private readonly deps: AuthzBraidDependencies,
    private readonly braidWrites: AuthzBraidWriteService,
  ) {}

  async listBraids({ projectId }: AuthzListBraidsInput): Promise<AuthzProjectBraids> {
    const lineage = await this.deps.lineage.findProjectLineage({ projectId });
    if (!lineage) return { intoOtherProjects: [], fromOtherProjects: [] };
    const rows = await this.deps.reads.findBraids({
      organizationId: lineage.organizationId,
      projectId,
    });
    const braids = withoutReplaced(rows).map(braidOf);
    return {
      intoOtherProjects: braids.filter((braid) => braid.ownerProjectId === projectId),
      fromOtherProjects: braids.filter((braid) => braid.readerProjectId === projectId),
    };
  }

  /** Every live braid in the organisation, for its admins (ADR-201 §2). */
  async listOrganizationBraids({
    organizationId,
  }: AuthzOrganizationInput): Promise<AuthzOrganizationBraids> {
    const rows = await this.deps.reads.findBraids({ organizationId });
    return withoutReplaced(rows).map(braidOf);
  }

  async createBraid(input: AuthzCreateBraidInput): Promise<AuthzBraid> {
    const { projectId: ownerProjectId, readerProjectId, actor, caller, commandId } = input;
    const terms = this.termsOf({ ownerProjectId, input });
    const organizationId = await this.organizationOfPair({ ownerProjectId, readerProjectId });
    await this.assertWithinCaller({ organizationId, caller, ownerProjectId });
    const request = { organizationId, readerProjectId, ownerProjectId, terms, actor, commandId };

    return this.deps.locks.withReaderLock({
      readerProjectId,
      write: async () => {
        const [recorded] = await this.braidWrites.recordedWriteOf({
          organizationId,
          actor,
          commandId,
        });
        if (recorded) return this.braidWrites.answerRepeat({ recorded, request });
        const live = withoutReplaced(
          await this.braidWrites.liveIntoReader({ organizationId, readerProjectId }),
        );
        const identical = live.find((row) => keyOf(row) === terms.key);
        if (identical) throw new BraidAlreadyExistsError({ braidId: identical.grantId });
        assertWithinConditionLimit({ live, readerProjectId, terms });
        return this.braidWrites.attach(request);
      },
    });
  }

  /**
   * Checked whole first; then, under the reader's lock, attach the new grant naming the old.
   * The worker revokes the old once the attach lands (ADR-201 §2), so the lock is not held for it.
   */
  async changeBraid(input: AuthzChangeBraidInput): Promise<AuthzBraid> {
    const { projectId: ownerProjectId, readerProjectId, braidId, actor, caller, commandId } = input;
    const terms = this.termsOf({ ownerProjectId, input });
    const organizationId = await this.organizationOfPair({ ownerProjectId, readerProjectId });
    await this.assertWithinCaller({ organizationId, caller, ownerProjectId });
    const request = { organizationId, readerProjectId, ownerProjectId, terms, actor, commandId };

    return this.deps.locks.withReaderLock({
      readerProjectId,
      write: async () => {
        const [recorded] = await this.braidWrites.recordedWriteOf({
          organizationId,
          actor,
          commandId,
        });
        if (recorded)
          return this.braidWrites.answerRepeat({ recorded, request, replacesGrantId: braidId });
        return this.changeUnderLock({ request, braidId });
      },
    });
  }

  private async changeUnderLock({
    request,
    braidId,
  }: {
    request: BraidRequest;
    braidId: string;
  }): Promise<AuthzBraid> {
    const { organizationId, readerProjectId, ownerProjectId, terms } = request;
    const live = await this.braidWrites.liveIntoReader({ organizationId, readerProjectId });
    const old = live.find((row) => row.grantId === braidId);
    if (!old) return this.braidWrites.refuseGone({ organizationId, braidId });
    if (old.ownerProjectId !== ownerProjectId) {
      throw new BraidNotOnProjectError({ braidId, projectId: ownerProjectId });
    }
    // Changed already, its revoke still the worker's: a repeat answers that change.
    const replacement = live.find((row) => row.replacesGrantId === braidId);
    if (replacement && keyOf(replacement) === terms.key) return braidOf(replacement);
    if (replacement) throw new BraidChangedError({ braidId });
    if (old.isReplaced) return this.braidWrites.refuseGone({ organizationId, braidId });
    if (keyOf(old) === terms.key) return braidOf(old);
    const others = withoutReplaced(live).filter((row) => row.grantId !== braidId);
    const identical = others.find((row) => keyOf(row) === terms.key);
    if (identical) throw new BraidAlreadyExistsError({ braidId: identical.grantId });
    assertWithinConditionLimit({ live: others, readerProjectId, terms });
    return this.braidWrites.attach({ ...request, replacesGrantId: braidId });
  }

  /**
   * The worker's half of a change (ADR-201 §2, §8): revoke the grant an attach replaced, as a
   * direct revoke does. A replay finds it revoked and does nothing; `commandId` keeps a resend
   * after a crash one fact.
   */
  async revokeReplacedGrant({
    organizationId,
    grantId,
    actor,
    commandId,
  }: {
    organizationId: string;
    grantId: string;
    actor: LedgerActor;
    commandId: string;
  }): Promise<void> {
    const [replaced] = await this.deps.reads.findBraids({
      organizationId,
      grantId,
      includeRevoked: true,
    });
    if (!replaced?.isLive) return;
    await this.deps.ledger.revokeBindings({
      organizationId,
      bindingIds: [grantId],
      actor,
      reason: BRAID_CHANGED_REASON,
      commandId,
    });
  }

  /** Either project's admins may remove a braid; a repeat after a failed epoch bump finishes. */
  async removeBraid({
    projectId,
    braidId,
    actor,
  }: AuthzRemoveBraidInput): Promise<AuthzBraidRemoved> {
    const lineage = await this.deps.lineage.findProjectLineage({ projectId });
    if (!lineage) throw new BraidNotOnProjectError({ braidId, projectId });
    const { organizationId } = lineage;
    const [braid] = await this.deps.reads.findBraids({
      organizationId,
      grantId: braidId,
      includeRevoked: true,
    });
    if (!braid || (braid.ownerProjectId !== projectId && braid.readerProjectId !== projectId)) {
      throw new BraidNotOnProjectError({ braidId, projectId });
    }

    return this.deps.locks.withReaderLock({
      readerProjectId: braid.readerProjectId,
      write: async () => {
        const [current] = await this.deps.reads.findBraids({
          organizationId,
          grantId: braidId,
          includeRevoked: true,
        });
        if (current?.isLive) {
          await this.revokeWhatItReplaced({ organizationId, braid: current, actor });
          await this.deps.ledger.revokeBindings({
            organizationId,
            bindingIds: [braidId],
            actor,
            reason: BRAID_REMOVED_REASON,
          });
          return { braidId };
        }
        if (current?.revokedReason !== BRAID_REMOVED_REASON) {
          return this.braidWrites.refuseGone({ organizationId, braidId });
        }
        await this.revokeWhatItReplaced({ organizationId, braid: current, actor });
        await this.deps.epoch.bump({ organizationId });
        return { braidId };
      },
    });
  }

  /** Removing a change's braid before the worker revoked the one it replaced revokes that one
   *  too, as the worker would; a later worker run finds it revoked and does nothing. */
  private async revokeWhatItReplaced({
    organizationId,
    braid,
    actor,
  }: {
    organizationId: string;
    braid: LedgerBraidRow;
    actor: LedgerActor;
  }): Promise<void> {
    if (braid.replacesGrantId === null) return;
    await this.revokeReplacedGrant({
      organizationId,
      grantId: braid.replacesGrantId,
      actor,
      commandId: `${BRAID_REMOVED_REASON}:${braid.grantId}:${braid.replacesGrantId}`,
    });
  }

  private termsOf({
    ownerProjectId,
    input,
  }: {
    ownerProjectId: string;
    input: { where?: string | undefined; fromMs: number; expiresAtMs?: number | undefined };
  }): BraidTerms {
    const text = (input.where ?? "").trim();
    const compiled = compileBraidCondition({ text });
    if (!compiled.ok) throw new BraidConditionRefusedError({ refusal: compiled });
    const now = this.braidWrites.nowMs();
    if (input.expiresAtMs !== undefined && input.expiresAtMs <= now) {
      throw new GrantExpiryInPastError({ expiresAtMs: input.expiresAtMs });
    }
    const condition: GrantCondition = {
      type: "span",
      ...(compiled.compiledWhere ? { where: text, compiledWhere: compiled.compiledWhere } : {}),
      from: Temporal.Instant.fromEpochMilliseconds(input.fromMs).toString(),
    };
    return {
      condition,
      expiresAtMs: input.expiresAtMs,
      key: braidKey({ ownerProjectId, condition, expiresAtMs: input.expiresAtMs ?? null }),
    };
  }

  /** Two distinct plain projects of one organisation (ADR-201 §1); answers that organisation. */
  private async organizationOfPair({
    ownerProjectId,
    readerProjectId,
  }: {
    ownerProjectId: string;
    readerProjectId: string;
  }): Promise<string> {
    if (ownerProjectId === readerProjectId) {
      throw new BraidIntoItselfError({ projectId: ownerProjectId });
    }
    const [owner, reader] = await Promise.all(
      [ownerProjectId, readerProjectId].map((projectId) =>
        this.deps.lineage.findProjectLineage({ projectId }),
      ),
    );
    for (const [projectId, lineage] of [
      [ownerProjectId, owner],
      [readerProjectId, reader],
    ] as const) {
      if (!lineage) throw new GrantValidationError("Project not found", { projectId });
      if (lineage.kind === "aggregate") throw new BraidAggregateProjectError({ projectId });
      if (lineage.kind === "internal_governance") {
        throw new BraidGovernanceProjectError({ projectId });
      }
    }
    if (!owner || !reader || owner.organizationId !== reader.organizationId) {
      throw new BraidAcrossOrganizationsError({ projectId: ownerProjectId, readerProjectId });
    }
    return owner.organizationId;
  }

  /** The ceiling runs on the owner: nobody braids spans they could not read themselves. */
  private async assertWithinCaller({
    organizationId,
    caller,
    ownerProjectId,
  }: {
    organizationId: string;
    caller: AuthzPrincipalRef;
    ownerProjectId: string;
  }): Promise<void> {
    const missing =
      caller.type === "anonymous"
        ? [...BRAID_CONFERRED_PERMISSIONS]
        : await this.deps.permissions.findPermissionsBeyondCaller({
            organizationId,
            caller,
            scope: { type: "project", id: ownerProjectId },
            permissions: [...BRAID_CONFERRED_PERMISSIONS],
          });
    if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
  }
}
