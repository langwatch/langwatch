// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one call the money fold makes on behalf of an erasure (ADR-128 §9 step 5).
 *
 * A rollup row's `RawActorId` is in the table's sorting key, so an erasure
 * cannot edit it: ClickHouse refuses a mutation on a key column, because a
 * changed key is a different row rather than an edited one (verified against
 * ClickHouse 26.2.1 — `Code: 420 CANNOT_UPDATE_COLUMN`). Erasure therefore
 * deletes the rows and replays the days. Which is only safe if the replay
 * writes the pseudonym rather than the original — otherwise the replay faithfully
 * re-derives the erased identifier from the raw event log and puts it straight
 * back, beside the row it was supposed to replace, duplicating the amount.
 *
 * So the fold consults the suppression list on the way past. Nothing is stored
 * to make this work: the pseudonym IS the digest that the membership test is
 * done with, so one hash answers both questions, and no table anywhere maps a
 * pseudonym back to the identifier it replaced.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import {
  ErasureSecretMissingError,
  erasureDigest,
  readErasureSecret,
} from "./erasureDigest";
import { currentSuppressionSnapshot } from "./suppressionSnapshot";

/**
 * The digest secret, read once per process.
 *
 * Absent is a normal state, not a failure: erasure refuses to run without the
 * secret, so a deployment that has none also has an empty suppression list and
 * nothing to substitute. Caching the absence keeps the fold from re-reading and
 * re-validating an unset variable on every money event.
 */
let cachedSecret: string | null | undefined;

function secretOrNull(): string | null {
  if (cachedSecret === undefined) {
    try {
      cachedSecret = readErasureSecret();
    } catch (error) {
      if (!(error instanceof ErasureSecretMissingError)) throw error;
      cachedSecret = null;
    }
  }
  return cachedSecret;
}

/** Forgets the cached secret. For tests, which change it between cases. */
export function resetErasureSecretCache(): void {
  cachedSecret = undefined;
}

/**
 * The actor id a rollup row should be written under: the pseudonym when this
 * identifier has been erased, and the original verbatim otherwise.
 *
 * Deterministic in the identifier, so every replay of every day lands on the
 * same key rather than minting a new one per run.
 */
export function actorIdForRollupWrite({
  tenantId,
  rawActorId,
}: {
  tenantId: string;
  rawActorId: string;
}): string {
  if (rawActorId === "") return rawActorId;

  const snapshot = currentSuppressionSnapshot();
  // No snapshot installed means no process here reads the suppression list —
  // which is every process on a deployment that has never erased anybody.
  if (!snapshot?.hasAnySuppressionForTenant(tenantId)) return rawActorId;

  const secret = secretOrNull();
  if (!secret) return rawActorId;

  const digest = erasureDigest({ secret, identifier: rawActorId });
  return snapshot.isSuppressedForTenant({ tenantId, identifierHash: digest })
    ? digest
    : rawActorId;
}
