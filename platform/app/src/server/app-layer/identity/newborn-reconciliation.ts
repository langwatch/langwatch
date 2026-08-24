import type { IdentityCeremonyWrites } from "@langwatch/identity-server";
import { newIdentityCommandId } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaIdentityNewbornRepository } from "./repositories/identity-newborn.prisma.repository";

const logger = createLogger("langwatch:identity:newborn-reconciliation");

/**
 * How long an entrance is given to finish before its claim reads as
 * abandoned. Generously above any sign-up's own latency: the cost of
 * sweeping too early is erasing a stream a retry was about to converge on,
 * and the cost of sweeping late is a few inert rows.
 */
export const IDENTITY_NEWBORN_ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** One pass's bound, so a sweep never becomes the pass that never ends. */
const MAX_SWEPT_PER_PASS = 200;

export interface IdentityNewbornReconciliationDeps {
  newborns: PrismaIdentityNewbornRepository;
  identity: Pick<IdentityCeremonyWrites, "eraseUser">;
  now?: () => number;
  abandonedAfterMs?: number;
}

export interface IdentityNewbornSweepSummary {
  examined: number;
  erased: number;
  failed: number;
}

/**
 * The reconciliation sweep ADR-116 §3 calls a required companion to the
 * born-finalized entrance, not optional hygiene.
 *
 * A flagged sign-up abandoned between the append and the row commit leaves
 * facts under a tenant that never gained a user row. Nothing SERVES them —
 * the fold declines to project a user that does not exist, and resolution
 * reads resolve nothing — but "nothing serves them" is not the same as "they
 * are gone": the facts carry the address the customer typed, and they carry
 * it forever.
 *
 * So the sweep erases the stream. It reaches for the same `erase_user`
 * command a real deletion uses (ADR-101 R11) rather than a deletion path of
 * its own — the facts are wiped by the fold the way every other erasure is,
 * and the audit record of the erasure is itself a fact.
 *
 * Shaped like the backfill's pass: one bounded pass over candidates, a
 * summary rather than a promise of completion, and a failure on one tenant
 * that does not abort the rest.
 */
export class IdentityNewbornReconciliationService {
  private readonly now: () => number;
  private readonly abandonedAfterMs: number;

  constructor(private readonly deps: IdentityNewbornReconciliationDeps) {
    this.now = deps.now ?? Date.now;
    this.abandonedAfterMs =
      deps.abandonedAfterMs ?? IDENTITY_NEWBORN_ABANDONED_AFTER_MS;
  }

  async runPass(): Promise<IdentityNewbornSweepSummary> {
    const abandoned = await this.deps.newborns.findAbandoned({
      olderThan: new Date(this.now() - this.abandonedAfterMs),
      limit: MAX_SWEPT_PER_PASS,
    });
    const summary: IdentityNewbornSweepSummary = {
      examined: abandoned.length,
      erased: 0,
      failed: 0,
    };
    for (const newborn of abandoned) {
      try {
        await this.erase(newborn.userId);
        summary.erased += 1;
      } catch (error) {
        // One unreachable stream must not cost the rest of the pass; the
        // claim survives, so the next pass tries again.
        summary.failed += 1;
        logger.warn(
          { userId: newborn.userId, error },
          "could not erase an abandoned newborn identity stream; the claim stays and the next pass retries",
        );
      }
    }
    if (summary.examined > 0) {
      logger.info(summary, "swept abandoned newborn identity streams");
    }
    return summary;
  }

  private async erase(userId: string): Promise<void> {
    await this.deps.identity.eraseUser({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "system", id: "system:identity-newborn-reconciliation" },
    });
    // Only once the erase landed: the claim is the sweep's only handle on
    // this stream, so dropping it first would strand anything that failed.
    await this.deps.newborns.releaseClaim({ userId });
  }
}
