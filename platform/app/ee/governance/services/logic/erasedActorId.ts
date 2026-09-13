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
  ERASURE_SECRET_ENV,
  ErasureSecretMissingError,
  erasureDigest,
  readErasureSecret,
} from "./erasureDigest";
import { currentSuppressionSnapshot } from "./suppressionSnapshot";

/**
 * Raised when this process has erasures to honour and no secret to honour them
 * with.
 *
 * Fatal on purpose, and the one place in this file that is. Every other
 * "cannot check" answer here means nobody has been erased, so writing the
 * identifier verbatim is correct. This one means somebody HAS been erased in
 * this tenant's organization and the pseudonym cannot be computed — at which
 * point there is no safe value to write. The identifier is the erased person's
 * plaintext email; a constant placeholder would collapse every actor in the
 * organization into one row and silently destroy the attribution behind a
 * total.
 *
 * So the money rows for this tenant stop until somebody sets the variable.
 * That is a loud, visible outage on a misconfigured deployment — which is the
 * point, because the alternative is a quiet one nobody discovers until an
 * erased address is found sitting in a money table.
 */
export class ErasureSecretRequiredError extends Error {
  name = "ErasureSecretRequiredError" as const;

  constructor(tenantId: string) {
    super(
      `Governance area ${tenantId} belongs to an organization that has erased somebody, but ${ERASURE_SECRET_ENV} is not set in this process, so the stand-in cannot be computed. Writing the identifier as it stands would put an erased person's address into the daily cost table. Set the same value every other process uses — a split deployment where the web side has it and the worker side does not produces exactly this.`,
    );
  }
}

/**
 * The digest secret, read once per process.
 *
 * Absent is a normal state on a deployment that has never erased anybody, so
 * this answers null rather than throwing and the callers decide. Caching the
 * absence keeps the fold from re-reading and re-validating an unset variable on
 * every money event.
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
 *
 * The secret is read AFTER the suppression list has been consulted, and the
 * order is the whole safety property. Read first, it looks like a normal
 * absent-configuration check with an obvious answer — write the identifier
 * through — and that answer is only correct while nobody has been erased. Past
 * the check below, somebody has.
 *
 * @throws {ErasureSecretRequiredError} when this tenant's organization has
 * erasures and this process has no secret to compute their stand-ins with.
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

  // Everything below this line runs only for an organization that has erased
  // somebody.
  const secret = secretOrNull();
  if (!secret) throw new ErasureSecretRequiredError(tenantId);

  const digest = erasureDigest({ secret, identifier: rawActorId });
  return snapshot.isSuppressedForTenant({ tenantId, identifierHash: digest })
    ? digest
    : rawActorId;
}
