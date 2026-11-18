import {
  BRAID_MAX_DISTINCT_CONDITIONS,
  braidConditionDigest,
  type GrantCondition,
  type LedgerActor,
} from "@langwatch/authorization";
import {
  BraidAcrossOrganizationsError,
  BraidAggregateProjectError,
  BraidAlreadyExistsError,
  BraidChangedError,
  BraidConditionLimitReachedError,
  BraidConditionRefusedError,
  BraidGovernanceProjectError,
  BraidIntoItselfError,
  BraidNotOnProjectError,
  AuthzGrantNotConfirmedError,
  GrantExceedsCallerPermissionsError,
  GrantExpiryInPastError,
  GrantValidationError,
  newAuthzGrantId,
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
import { nowInstant, Temporal } from "@langwatch/time";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type { AuthzBraidLockRepository } from "../repositories/authz-braid-lock.repository.ts";
import type {
  AuthzBraidWrite,
  AuthzBraidWriteRepository,
} from "../repositories/authz-braid-write.repository.ts";
import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type {
  AuthzLedgerReadRepository,
  LedgerBraidRow,
} from "../repositories/authz-ledger-read.repository.ts";
import type { ScopeLineageRepository } from "../repositories/authz-read.repository.ts";
import type { AuthzGrantWriterPermissions } from "./authz-grant-writer.service.ts";

/** What a braid confers on the owner: a span window opens span reads alone (ADR-201 §1, v4.9). */
const BRAID_CONFERRED_PERMISSIONS = ["traces:view"] as const;
export const BRAID_REMOVED_REASON = "braid_removed";
export const BRAID_CHANGED_REASON = "braid_changed";
const NO_CONDITION_DIGEST = "none";
/** How long a recorded write the grant projection has not landed still counts as being saved. */
const IN_FLIGHT_WINDOW_MS = 60 * 60_000;

type BraidTerms = { condition: GrantCondition; expiresAtMs: number | undefined; key: string };
type BraidRequest = {
  organizationId: string;
  readerProjectId: string;
  ownerProjectId: string;
  terms: BraidTerms;
  actor: LedgerActor;
  commandId: string | undefined;
};

/**
 * ADR-201 §1-§2: a braid is a shared span grant from the owner project to the reader project.
 * The door asked the permissions; this service checks what needs the loaded rows: the projects,
 * the caller's ceiling on the owner, the condition, and the reader's live braids under its lock.
 */
export class AuthzBraidService {
  static create(deps: {
    ledger: Pick<EventingAuthzLedgerAdapter, "attachBraidGrant" | "revokeBindings">;
    reads: Pick<AuthzLedgerReadRepository, "findBraids" | "findStoredGrantIds">;
    lineage: Pick<ScopeLineageRepository, "findProjectLineage">;
    locks: AuthzBraidLockRepository;
    writes: AuthzBraidWriteRepository;
    epoch: Pick<AuthzEpochRepository, "bump">;
    permissions: Pick<AuthzGrantWriterPermissions, "findPermissionsBeyondCaller">;
    now?: () => number;
    newGrantId?: () => string;
  }): AuthzBraidService {
    return new AuthzBraidService(deps);
  }

  private constructor(private readonly deps: Parameters<typeof AuthzBraidService.create>[0]) {}

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
        const [recorded] = await this.recordedWriteOf({ organizationId, commandId });
        if (recorded) return this.answerRepeat({ recorded, request });
        const live = withoutReplaced(
          await this.liveIntoReader({ organizationId, readerProjectId }),
        );
        const identical = live.find((row) => keyOf(row) === terms.key);
        if (identical) throw new BraidAlreadyExistsError({ braidId: identical.grantId });
        assertWithinConditionLimit({ live, readerProjectId, terms });
        return this.attach(request);
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
        const [recorded] = await this.recordedWriteOf({ organizationId, commandId });
        if (recorded) return this.answerRepeat({ recorded, request, replacesGrantId: braidId });
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
    const live = await this.liveIntoReader({ organizationId, readerProjectId });
    const old = live.find((row) => row.grantId === braidId);
    if (!old) return this.refuseGone({ organizationId, braidId });
    if (old.ownerProjectId !== ownerProjectId) {
      throw new BraidNotOnProjectError({ braidId, projectId: ownerProjectId });
    }
    // Changed already, its revoke still the worker's: a repeat answers that change.
    const replacement = live.find((row) => row.replacesGrantId === braidId);
    if (replacement && keyOf(replacement) === terms.key) return braidOf(replacement);
    if (replacement) throw new BraidChangedError({ braidId });
    if (old.isReplaced) return this.refuseGone({ organizationId, braidId });
    if (keyOf(old) === terms.key) return braidOf(old);
    const others = withoutReplaced(live).filter((row) => row.grantId !== braidId);
    const identical = others.find((row) => keyOf(row) === terms.key);
    if (identical) throw new BraidAlreadyExistsError({ braidId: identical.grantId });
    assertWithinConditionLimit({ live: others, readerProjectId, terms });
    return this.attach({ ...request, replacesGrantId: braidId });
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
          return this.refuseGone({ organizationId, braidId });
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

  /** A braid no longer live: the epoch moves (finishing a repeat whose bump failed); refuse. */
  private async refuseGone({
    organizationId,
    braidId,
  }: {
    organizationId: string;
    braidId: string;
  }): Promise<never> {
    await this.deps.epoch.bump({ organizationId });
    throw new BraidChangedError({ braidId });
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
    const now = this.nowMs();
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

  /** The reader's live braids, with the writes recorded but not yet projected (ADR-201 §1). */
  private async liveIntoReader({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<LedgerBraidRow[]> {
    // Writes and stored ids first, projection last: a write landing in between is in the rows.
    const recent = await this.deps.writes.findIntoReaderSince({
      organizationId,
      readerProjectId,
      since: Temporal.Instant.fromEpochMilliseconds(this.nowMs() - IN_FLIGHT_WINDOW_MS),
    });
    const stored = new Set(
      recent.length === 0
        ? []
        : await this.deps.reads.findStoredGrantIds({
            organizationId,
            grantIds: recent.map((write) => write.grantId),
          }),
    );
    const rows = await this.deps.reads.findBraids({ organizationId, projectId: readerProjectId });
    const projected = rows.filter((row) => row.readerProjectId === readerProjectId);
    return [...projected, ...recent.filter((write) => !stored.has(write.grantId)).map(rowOfWrite)];
  }

  private async recordedWriteOf({
    organizationId,
    commandId,
  }: {
    organizationId: string;
    commandId: string | undefined;
  }): Promise<AuthzBraidWrite[]> {
    if (commandId === undefined) return [];
    return this.deps.writes.findByCommand({
      organizationId,
      commandId: ledgerCommandIdOf(commandId),
    });
  }

  /**
   * A command id already sent answers its braid: the projected row once landed, else the same
   * command resent (the ledger keeps one fact) and awaited. Other terms under it are refused.
   */
  private async answerRepeat({
    recorded,
    request,
    replacesGrantId,
  }: {
    recorded: AuthzBraidWrite;
    request: BraidRequest;
    replacesGrantId?: string;
  }): Promise<AuthzBraid> {
    const { organizationId } = request;
    const recordedRequest = [
      recorded.readerProjectId,
      recorded.ownerProjectId,
      recorded.termsKey,
      recorded.replacesGrantId,
    ];
    const thisRequest = [
      request.readerProjectId,
      request.ownerProjectId,
      request.terms.key,
      replacesGrantId ?? null,
    ];
    if (JSON.stringify(recordedRequest) !== JSON.stringify(thisRequest)) {
      throw new GrantValidationError("This command id was already used for another braid", {
        commandId: request.commandId,
      });
    }
    const [row] = await this.deps.reads.findBraids({
      organizationId,
      grantId: recorded.grantId,
      includeRevoked: true,
    });
    if (row && !row.isLive) return this.refuseGone({ organizationId, braidId: row.grantId });
    if (row) return braidOf(row);
    await this.send({ write: recorded, actor: request.actor });
    return braidOf(rowOfWrite(recorded));
  }

  /** Records the write before its command, so a retry or a twin sees it while it is in flight. */
  private async attach({
    organizationId,
    readerProjectId,
    ownerProjectId,
    terms,
    actor,
    commandId,
    replacesGrantId,
  }: BraidRequest & { replacesGrantId?: string }): Promise<AuthzBraid> {
    const grantId = this.deps.newGrantId?.() ?? newAuthzGrantId();
    const write: AuthzBraidWrite = {
      organizationId,
      commandId: commandId === undefined ? `braid:${grantId}` : ledgerCommandIdOf(commandId),
      grantId,
      readerProjectId,
      ownerProjectId,
      termsKey: terms.key,
      condition: terms.condition,
      expiresAt:
        terms.expiresAtMs === undefined
          ? null
          : Temporal.Instant.fromEpochMilliseconds(terms.expiresAtMs),
      replacesGrantId: replacesGrantId ?? null,
      createdByUserId: actor.type === "user" ? actor.id : null,
      createdAt: Temporal.Instant.fromEpochMilliseconds(this.nowMs()),
    };
    await this.deps.writes.create({ write });
    try {
      await this.send({ write, actor });
    } catch (error) {
      // Unconfirmed may still land, so it stays in flight; any other refusal never will.
      if (!(error instanceof AuthzGrantNotConfirmedError)) {
        await this.deps.writes.delete({ organizationId, commandId: write.commandId });
      }
      throw error;
    }
    return braidOf(rowOfWrite(write));
  }

  private async send({ write, actor }: { write: AuthzBraidWrite; actor: LedgerActor }) {
    await this.deps.ledger.attachBraidGrant({
      organizationId: write.organizationId,
      readerProjectId: write.readerProjectId,
      ownerProjectId: write.ownerProjectId,
      condition: write.condition,
      ...(write.expiresAt === null ? {} : { expiresAtMs: write.expiresAt.epochMilliseconds }),
      ...(write.replacesGrantId === null ? {} : { replacesGrantId: write.replacesGrantId }),
      actor,
      grantId: write.grantId,
      commandId: write.commandId,
      occurredAtMs: write.createdAt.epochMilliseconds,
    });
  }

  private nowMs(): number {
    return this.deps.now?.() ?? nowInstant().epochMilliseconds;
  }
}

/** A client's command id in the ledger's namespace of braid commands, apart from every other. */
function ledgerCommandIdOf(commandId: string): string {
  return `braid:cmd:${commandId}`;
}

/** A recorded write the grant projection has not landed, read as the live braid it will be. */
function rowOfWrite(write: AuthzBraidWrite): LedgerBraidRow {
  return {
    grantId: write.grantId,
    ownerProjectId: write.ownerProjectId,
    readerProjectId: write.readerProjectId,
    condition: write.condition,
    expiresAt: write.expiresAt,
    createdByUserId: write.createdByUserId,
    occurredAt: write.createdAt,
    revokedReason: null,
    isLive: true,
    replacesGrantId: write.replacesGrantId,
    isReplaced: false,
  };
}

/** A live grant a change replaced is on its way out, even once its replacement is removed: it
 *  neither blocks, counts nor lists (ADR-201 §2). */
function withoutReplaced(live: readonly LedgerBraidRow[]): LedgerBraidRow[] {
  const replaced = new Set(live.map((row) => row.replacesGrantId));
  return live.filter((row) => !row.isReplaced && !replaced.has(row.grantId));
}

/** A reader holds at most BRAID_MAX_DISTINCT_CONDITIONS distinct compiled conditions (§3). */
function assertWithinConditionLimit({
  live,
  readerProjectId,
  terms,
}: {
  live: readonly LedgerBraidRow[];
  readerProjectId: string;
  terms: BraidTerms;
}): void {
  const held = new Set(live.map((row) => conditionDigestOf(row.condition)));
  const added = conditionDigestOf(terms.condition);
  if (!held.has(added) && held.size >= BRAID_MAX_DISTINCT_CONDITIONS) {
    throw new BraidConditionLimitReachedError({
      readerProjectId,
      limit: BRAID_MAX_DISTINCT_CONDITIONS,
    });
  }
}

function conditionDigestOf(condition: GrantCondition | null): string {
  return condition?.compiledWhere
    ? braidConditionDigest(condition.compiledWhere)
    : NO_CONDITION_DIGEST;
}

/** Identical braids share owner, compiled condition, data window and end date. */
function braidKey({
  ownerProjectId,
  condition,
  expiresAtMs,
}: {
  ownerProjectId: string;
  condition: GrantCondition | null;
  expiresAtMs: number | null;
}): string {
  return JSON.stringify([
    ownerProjectId,
    conditionDigestOf(condition),
    condition?.from === undefined ? null : msOf(condition.from),
    condition?.until === undefined ? null : msOf(condition.until),
    expiresAtMs,
  ]);
}

function keyOf(row: LedgerBraidRow): string {
  return braidKey({
    ownerProjectId: row.ownerProjectId,
    condition: row.condition,
    expiresAtMs: row.expiresAt?.epochMilliseconds ?? null,
  });
}

function msOf(iso: string | undefined): number {
  return iso === undefined ? 0 : Temporal.Instant.from(iso).epochMilliseconds;
}

function braidOf(row: LedgerBraidRow): AuthzBraid {
  return {
    braidId: row.grantId,
    ownerProjectId: row.ownerProjectId,
    readerProjectId: row.readerProjectId,
    where: row.condition?.where ?? null,
    fromMs: msOf(row.condition?.from),
    expiresAtMs: row.expiresAt?.epochMilliseconds ?? null,
    createdByUserId: row.createdByUserId,
    createdAtMs: row.occurredAt.epochMilliseconds,
  };
}
