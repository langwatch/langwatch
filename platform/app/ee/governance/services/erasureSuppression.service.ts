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

import {
  ErasedIdentifierSuppressionRepository,
  GovernanceTenantHistoryRepository,
} from "../repositories/governanceIdentity.repository";
import {
  ErasureSecretMissingError,
  erasureDigest,
  readErasureSecret,
} from "./logic/erasureDigest";
import {
  installSuppressionSnapshot,
  type SuppressionSnapshotData,
  type SuppressionSnapshotLoader,
} from "./logic/suppressionSnapshot";

const logger = createLogger("langwatch:governance:erasure-suppression");

const repository = new ErasedIdentifierSuppressionRepository();
const tenantHistoryRepository = new GovernanceTenantHistoryRepository();

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
 *
 * The list is read BEFORE the secret, and that order carries the meaning. An
 * absent secret is only unremarkable while the list is empty: on a deployment
 * that has never erased anybody it is the normal state and not worth a line per
 * run. Once there are rows on the list, the same absent secret means this
 * process cannot evaluate erasures that somebody has actually asked for, which
 * is a misconfiguration and gets said out loud. Reading the secret first made
 * those two cases look identical and answered both with silence.
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

  // Nothing erased here, so nothing to check and no secret needed.
  if (hashes.size === 0) return NO_SUPPRESSION;

  let secret: string;
  try {
    secret = readErasureSecret();
  } catch (error) {
    if (!(error instanceof ErasureSecretMissingError)) throw error;
    logger.error(
      { error, organizationId, provider, suppressedIdentifiers: hashes.size },
      "This organization has erased identifiers but this process has no erasure secret, so the list cannot be checked; this run will not suppress anything and an erased identifier may be re-imported. Set the same secret every other process uses — a split deployment where one side has it and the other does not produces exactly this",
    );
    return NO_SUPPRESSION;
  }

  return {
    isEmpty: false,
    isSuppressed: (identifier: string) =>
      identifier !== "" && hashes.has(erasureDigest({ secret, identifier })),
  };
}

/**
 * The read behind the fold's snapshot: every suppression row and every recorded
 * tenant, in one pass, for every organization on the deployment.
 *
 * Deployment-wide rather than per-organization because the fold does not get to
 * choose what arrives — it is handed a `tenantId` by the executor and must
 * answer synchronously, so the whole picture has to already be in hand. Both
 * tables are small by construction: one row per erased identifier, one row per
 * governance project ever used.
 *
 * The provider is dropped on purpose. The fold's check is organization-wide,
 * for the reason in this module's header, so carrying the provider through
 * would only invite somebody to start filtering on it.
 */
export function createSuppressionSnapshotLoader(
  prisma: PrismaClient,
): SuppressionSnapshotLoader {
  return async (): Promise<SuppressionSnapshotData> => {
    const [suppressions, tenants] = await Promise.all([
      repository.findAll(prisma),
      tenantHistoryRepository.findAll(prisma),
    ]);

    const digestsByOrganization = new Map<string, Set<string>>();
    for (const row of suppressions) {
      const digests =
        digestsByOrganization.get(row.organizationId) ?? new Set<string>();
      digests.add(row.identifierHash);
      digestsByOrganization.set(row.organizationId, digests);
    }

    return {
      digestsByOrganization,
      organizationByTenant: new Map(
        tenants.map((row) => [row.tenantId, row.organizationId]),
      ),
    };
  };
}

/**
 * Gives this process the view of the suppression list that the money fold reads.
 *
 * The composition root calls this, and so does the test that proves the
 * substitution happens — one entry point, so the thing under test is the thing
 * that ships. Without it `actorIdForRollupWrite` finds no snapshot and returns
 * every identifier verbatim, which is correct behaviour for a process that
 * cannot reach Postgres and a silent data leak for one that can.
 *
 * Cheap to call unconditionally: nothing is read until the first money event
 * asks a question, so a process that never folds never touches the tables.
 */
export function installGovernanceSuppressionSnapshot(
  prisma: PrismaClient,
): void {
  installSuppressionSnapshot({ load: createSuppressionSnapshotLoader(prisma) });
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
