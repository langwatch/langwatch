import {
  BRAID_MAX_DISTINCT_CONDITIONS,
  braidConditionDigest,
  type GrantCondition,
  type LedgerActor,
} from "@langwatch/authorization";
import { BraidConditionLimitReachedError, type AuthzBraid } from "@langwatch/authz-contract";
import { Temporal } from "@langwatch/time";

import type { AuthzBraidWrite } from "../repositories/authz-braid-write.repository.ts";
import type { LedgerBraidRow } from "../repositories/authz-ledger-read.repository.ts";

const NO_CONDITION_DIGEST = "none";

export type BraidTerms = {
  condition: GrantCondition;
  expiresAtMs: number | undefined;
  key: string;
};
export type BraidRequest = {
  organizationId: string;
  readerProjectId: string;
  ownerProjectId: string;
  terms: BraidTerms;
  actor: LedgerActor;
  commandId: string | undefined;
};

/** A client's command id in the ledger's braid namespace, bound to the actor who sent it. */
export function ledgerCommandIdOf({
  actor,
  commandId,
}: {
  actor: LedgerActor;
  commandId: string;
}): string {
  return `braid:cmd:${actor.type}:${actor.id ?? ""}:${commandId}`;
}

/** A recorded write the grant projection has not landed, read as the live braid it will be. */
export function rowOfWrite(write: AuthzBraidWrite): LedgerBraidRow {
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
export function withoutReplaced(live: readonly LedgerBraidRow[]): LedgerBraidRow[] {
  const replaced = new Set(live.map((row) => row.replacesGrantId));
  return live.filter((row) => !row.isReplaced && !replaced.has(row.grantId));
}

/** A reader holds at most BRAID_MAX_DISTINCT_CONDITIONS distinct compiled conditions (§3). */
export function assertWithinConditionLimit({
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
export function braidKey({
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

export function keyOf(row: LedgerBraidRow): string {
  return braidKey({
    ownerProjectId: row.ownerProjectId,
    condition: row.condition,
    expiresAtMs: row.expiresAt?.epochMilliseconds ?? null,
  });
}

function msOf(iso: string | undefined): number {
  return iso === undefined ? 0 : Temporal.Instant.from(iso).epochMilliseconds;
}

export function braidOf(row: LedgerBraidRow): AuthzBraid {
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
