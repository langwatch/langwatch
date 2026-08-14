import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";
import { closeOpenLinksForMembership } from "~/server/users/close-open-links";

const logger = createLogger("langwatch:identity-links:orphan-sweep");

/**
 * How many (organization, person) pairs one pass will look at. Hitting it is a
 * signal, not a routine outcome: every offboarding path writes its closing
 * rows in the membership change's own transaction, so a backlog this size
 * means one of them stopped doing that.
 */
export const ORPHAN_LINK_SWEEP_BATCH = 1000;

export interface OrphanLinkSweepResult {
  /** Person/organization pairs examined. */
  candidates: number;
  /** Closing rows appended — zero on a healthy fleet. */
  closed: number;
}

/**
 * The self-healing backstop for offboarding (ADR-094 Decision 4).
 *
 * SCHEDULING LIVES ELSEWHERE. This module owns one pass; the
 * `orphanLinkSweep` process manager (pipelines/identity-links-maintenance)
 * owns when it runs and fences it across replicas.
 *
 * It finds people who still hold usage-attribution links in an organization
 * they have no active membership of, and appends the closing rows that path
 * should have written. It is the ADR's *additional* net, never the designated
 * writer: a path that relied on this instead of its own transaction would
 * reopen exactly the loss window the same-transaction rule closes.
 *
 * Idempotent, and that is load-bearing rather than incidental: the close is
 * decided from the timeline, so once the latest row for a login is the unlink,
 * every later pass appends nothing. The cost of that is a candidate set that
 * does not shrink — an offboarded person keeps matching the anti-join forever,
 * because their older rows still name them. At the fleet's size (thousands of
 * organizations, a handful of provider connections between them) that is two
 * indexed reads per pair and no writes. If it ever stops being cheap, the fix
 * is a watermark on the pair, not a different mechanism.
 */
export async function runOrphanLinkSweep({
  prisma,
  now = () => new Date(),
}: {
  prisma: PrismaClient;
  now?: () => Date;
}): Promise<OrphanLinkSweepResult> {
  // An anti-join: link rows naming a person who holds no active membership of
  // that organization. Raw because Prisma cannot express NOT EXISTS across a
  // relationless column pair, and this sweep spans every tenant by design —
  // the same posture the other fleet-wide maintenance passes take.
  const candidates = await prisma.$queryRaw<
    Array<{ organizationId: string; userId: string }>
  >`
    SELECT DISTINCT l."organizationId", l."userId"
    FROM "ProviderIdentityLink" l
    WHERE l."userId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "OrganizationUser" ou
        WHERE ou."userId" = l."userId"
          AND ou."organizationId" = l."organizationId"
          AND ou."disabledAt" IS NULL
      )
    ORDER BY l."organizationId", l."userId"
    LIMIT ${ORPHAN_LINK_SWEEP_BATCH}
  `;

  let closed = 0;
  for (const { organizationId, userId } of candidates) {
    closed += await prisma.$transaction((tx) =>
      closeOpenLinksForMembership({
        tx,
        organizationId,
        userId,
        // No session behind a sweep, and no admin to name: the row says only
        // that offboarding closed it.
        actorUserId: null,
        now: now(),
      }),
    );
  }

  if (closed > 0) {
    logger.warn(
      { candidates: candidates.length, closed },
      "Closed usage-attribution links left open by an offboarding — the path that ended the membership should have written these in its own transaction",
    );
  }

  if (candidates.length === ORPHAN_LINK_SWEEP_BATCH) {
    logger.warn(
      { batch: ORPHAN_LINK_SWEEP_BATCH },
      "Orphan link sweep filled its batch; the remainder waits for the next pass",
    );
  }

  return { candidates: candidates.length, closed };
}
