import { createHash } from "node:crypto";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import type { LedgerPrincipal, LedgerScope } from "./grants-ledger.reducer";

/**
 * Deterministic grant identity (ADR-092 §13 doctrine: ids are functions of
 * event content). The id is a real KSUID — `grant_`-prefixed, k-sortable by
 * business time — but every bit of it is derived, none of it random: the
 * timestamp is the fact's `occurredAt`, and the instance and sequence bytes
 * come from a hash of the fact's content. The same fact always derives the
 * same id, which is what makes the genesis import, the backfill, and every
 * projection upsert idempotent without transactions.
 *
 * What is (and isn't) identity:
 * - The role is NOT part of it: changing a principal's role at a scope is
 *   `grant_role_changed` on the same id, not a new fact.
 * - Business time IS part of it (it is the KSUID timestamp): re-attaching
 *   the same principal at the same scope after a revoke is a new fact with
 *   a new id, while re-importing or retrying the SAME fact — whose
 *   `occurredAt` is fixed by the legacy row or by the originating command —
 *   derives the same id.
 * - Resource-tier grants key on the token: one resource can carry several
 *   links (ADR-057 dropped one-share-per-resource), and the token is the
 *   credential's own identity.
 */
export function deriveGrantId({
  organizationId,
  principal,
  scope,
  resourceToken,
  occurredAtMs,
}: {
  organizationId: string;
  principal: LedgerPrincipal;
  scope: LedgerScope;
  resourceToken?: string;
  occurredAtMs: number;
}): string {
  const parts = [
    organizationId,
    principal.type,
    principal.id ?? "",
    scope.type,
    scope.id,
    resourceToken ?? "",
  ];
  // Unit separator, not a space: no part may smuggle a boundary character.
  const digest = createHash("sha256")
    .update(parts.join(""))
    .digest();
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(digest.buffer, digest.byteOffset, 8),
  );
  const sequenceId = digest.readUInt32BE(8);
  const timestampSeconds = Math.floor(occurredAtMs / 1000);
  return new Ksuid(
    getEnvironment(),
    "grant",
    timestampSeconds,
    instance,
    sequenceId,
  ).toString();
}
