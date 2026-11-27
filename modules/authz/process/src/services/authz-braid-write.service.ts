import type { LedgerActor } from "@langwatch/authorization";
import {
  BraidChangedError,
  GrantValidationError,
  newAuthzGrantId,
  type AuthzBraid,
} from "@langwatch/authz-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import type { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import type {
  AuthzBraidWrite,
  AuthzBraidWriteRepository,
} from "../repositories/authz-braid-write.repository.ts";
import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type {
  AuthzLedgerReadRepository,
  LedgerBraidRow,
} from "../repositories/authz-ledger-read.repository.ts";
import {
  braidOf,
  ledgerCommandIdOf,
  rowOfWrite,
  type BraidRequest,
} from "../rules/authz-braid.rules.ts";

export type AuthzBraidWriteDependencies = {
  ledger: Pick<EventingAuthzLedgerAdapter, "attachBraidGrant" | "awaitSharedProjectGrants">;
  reads: Pick<AuthzLedgerReadRepository, "findBraids" | "findStoredGrantIds">;
  writes: AuthzBraidWriteRepository;
  epoch: Pick<AuthzEpochRepository, "bump">;
  now?: () => number;
  newGrantId?: () => string;
};

/**
 * ADR-201 §1: a braid's write recorded before its attach, so a retry with its command id answers
 * the braid it saved and the reader's checks count a braid the grant projection has not landed.
 * The caller holds the reader's lock around every method here.
 */
export class AuthzBraidWriteService {
  static create(deps: AuthzBraidWriteDependencies): AuthzBraidWriteService {
    return new AuthzBraidWriteService(deps);
  }

  private constructor(private readonly deps: AuthzBraidWriteDependencies) {}

  /** The reader's live braids, with every write recorded but not projected, whatever its age. */
  async liveIntoReader({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<LedgerBraidRow[]> {
    // Writes and stored ids first, projection last: a write landing in between is in the rows.
    const recorded = await this.deps.writes.findIntoReader({ organizationId, readerProjectId });
    const stored = new Set(
      recorded.length === 0
        ? []
        : await this.deps.reads.findStoredGrantIds({
            organizationId,
            grantIds: recorded.map((write) => write.grantId),
          }),
    );
    const rows = await this.deps.reads.findBraids({ organizationId, projectId: readerProjectId });
    const projected = rows.filter((row) => row.readerProjectId === readerProjectId);
    return [
      ...projected,
      ...recorded.filter((write) => !stored.has(write.grantId)).map(rowOfWrite),
    ];
  }

  /** The write this actor's command id sent; another actor's same id is another command. */
  async recordedWriteOf({
    organizationId,
    actor,
    commandId,
  }: {
    organizationId: string;
    actor: LedgerActor;
    commandId: string | undefined;
  }): Promise<AuthzBraidWrite[]> {
    if (commandId === undefined) return [];
    return this.deps.writes.findByCommand({
      organizationId,
      commandId: ledgerCommandIdOf({ actor, commandId }),
    });
  }

  /**
   * A command id already sent answers its braid: the projected row once landed, else the same
   * command resent (the ledger keeps one fact) and awaited. Other terms under it are refused, and
   * so is a change whose braid stopped being live meanwhile, as a fresh change would be.
   */
  async answerRepeat({
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
    await this.#assertReplacedStillLive({ recorded });
    await this.#send({ write: recorded, actor: request.actor });
    await this.#confirm({ write: recorded });
    return braidOf(rowOfWrite(recorded));
  }

  /**
   * Records the write before its command, so a retry or a twin sees it while it is in flight.
   * Only a command the ledger did not accept is forgotten: once accepted it may still land.
   */
  async attach({
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
      commandId:
        commandId === undefined ? `braid:${grantId}` : ledgerCommandIdOf({ actor, commandId }),
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
      await this.#send({ write, actor });
    } catch (error) {
      await this.deps.writes.delete({ organizationId, commandId: write.commandId });
      throw error;
    }
    await this.#confirm({ write });
    return braidOf(rowOfWrite(write));
  }

  /** A braid no longer live: the epoch moves (finishing a repeat whose bump failed); refuse. */
  async refuseGone({
    organizationId,
    braidId,
  }: {
    organizationId: string;
    braidId: string;
  }): Promise<never> {
    await this.deps.epoch.bump({ organizationId });
    throw new BraidChangedError({ braidId });
  }

  nowMs(): number {
    return this.deps.now?.() ?? nowInstant().epochMilliseconds;
  }

  /** A change resent only while the braid it replaces is live and replaced by nothing else. */
  async #assertReplacedStillLive({ recorded }: { recorded: AuthzBraidWrite }): Promise<void> {
    const braidId = recorded.replacesGrantId;
    if (braidId === null) return;
    const { organizationId, readerProjectId } = recorded;
    const live = await this.liveIntoReader({ organizationId, readerProjectId });
    const replacedElsewhere = live.some(
      (row) => row.replacesGrantId === braidId && row.grantId !== recorded.grantId,
    );
    const old = live.find((row) => row.grantId === braidId);
    if (!old || old.isReplaced || replacedElsewhere) {
      await this.refuseGone({ organizationId, braidId });
    }
  }

  async #send({ write, actor }: { write: AuthzBraidWrite; actor: LedgerActor }): Promise<void> {
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

  /** Read-your-writes on an accepted attach; its failure leaves the write recorded. */
  async #confirm({ write }: { write: AuthzBraidWrite }): Promise<void> {
    await this.deps.ledger.awaitSharedProjectGrants({
      organizationId: write.organizationId,
      grantIds: [write.grantId],
    });
  }
}
