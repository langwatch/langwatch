// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The check that makes an erasure hold (ADR-128 §9 step 1).
 *
 * Erasing a person from the governance tables is undone within a day by the
 * pipeline that produced them: the pullers look thirty days back, so the next
 * run re-reads the same window, finds the same email address on the same cost
 * row, and writes it all back. Deleting is therefore only half of an erasure.
 * The other half is a list of what must never be re-imported, consulted at
 * every write path that carries an identifier.
 *
 * It stores digests and never identifiers, so the list is not itself a copy of
 * the data it exists to keep out.
 *
 * Provider-scoped, unlike the fold's own check: dropping a record is
 * destructive, so a match here has to mean "this organization erased this
 * identifier AT THIS PROVIDER" and not merely "somewhere". The same string can
 * be a different person under a different provider. The fold's check is
 * organization-wide because its failure mode is the opposite — it replaces
 * rather than drops, so over-matching costs nothing and under-matching leaves
 * personal data in a money table.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

import { ErasedIdentifierSuppressionRepository } from "../repositories/governanceIdentity.repository";
import {
  ErasureSecretMissingError,
  erasureDigest,
  readErasureSecret,
} from "./logic/erasureDigest";

const logger = createLogger("langwatch:governance:erasure-suppression");

const repository = new ErasedIdentifierSuppressionRepository();

/**
 * The suppression answer for one (organization, provider), resolved once and
 * asked many times.
 *
 * Resolved per pull RUN rather than per event, matching how the puller already
 * resolves its cost-recording flag: the answer cannot change mid-batch, and a
 * lookup per row would put a Postgres round trip on the ingest path for a
 * decision that was already made.
 */
export interface ErasureSuppressionCheck {
  /** Whether this identifier was erased for this organization and provider. */
  isSuppressed(identifier: string): boolean;
  /** Whether anything is suppressed at all — the usual answer is nothing. */
  readonly isEmpty: boolean;
}

/** A check that suppresses nothing, for every path with nothing to suppress. */
export const NO_SUPPRESSION: ErasureSuppressionCheck = {
  isSuppressed: () => false,
  isEmpty: true,
};

/**
 * Loads one organization's suppression list for one provider.
 *
 * Fails OPEN, loudly. A pull that refused to run because Postgres blinked
 * would turn a transient fault into missing cost data, and the erasure it was
 * protecting is re-applied on the next run. A pull that silently stopped
 * checking would let an erased identifier back in with nothing to say so —
 * hence the error log rather than a swallow.
 */
export async function loadErasureSuppression({
  prisma,
  organizationId,
  provider,
}: {
  prisma: PrismaClient;
  organizationId: string;
  provider: string;
}): Promise<ErasureSuppressionCheck> {
  let secret: string;
  try {
    secret = readErasureSecret();
  } catch (error) {
    if (!(error instanceof ErasureSecretMissingError)) throw error;
    // No secret means no erasure has ever run here, so there is nothing on the
    // list and nothing to check. Not a fault, and not worth a log line per run.
    return NO_SUPPRESSION;
  }

  let hashes: Set<string>;
  try {
    const rows = await repository.findAllByOrganization(prisma, {
      organizationId,
    });
    hashes = new Set(
      rows
        .filter((row) => row.provider === provider)
        .map((row) => row.identifierHash),
    );
  } catch (error) {
    logger.error(
      { error, organizationId, provider },
      "Could not read the erased-identifier suppression list; this run will not suppress anything, and an erased identifier may be re-imported",
    );
    return NO_SUPPRESSION;
  }

  if (hashes.size === 0) return NO_SUPPRESSION;

  return {
    isEmpty: false,
    isSuppressed: (identifier: string) =>
      identifier !== "" && hashes.has(erasureDigest({ secret, identifier })),
  };
}

/** What one batch kept, and how much of it the erasure list held back. */
export interface SuppressionPartition<T> {
  kept: T[];
  suppressedCount: number;
}

/**
 * Splits a pulled batch into what may be written and what may not.
 *
 * A suppressed item is dropped rather than written and erased again later —
 * the identifier rides in three places on the way through (the structured
 * actor column, the raw payload blob, and the cost record's actor id), and
 * scrubbing a JSON document after the fact is not something a column
 * substitution can do.
 */
export function partitionSuppressedEvents<T>({
  events,
  actorOf,
  suppression,
}: {
  events: readonly T[];
  actorOf: (event: T) => string;
  suppression: ErasureSuppressionCheck;
}): SuppressionPartition<T> {
  if (suppression.isEmpty) {
    return { kept: [...events], suppressedCount: 0 };
  }
  const kept = events.filter(
    (event) => !suppression.isSuppressed(actorOf(event)),
  );
  return { kept, suppressedCount: events.length - kept.length };
}
