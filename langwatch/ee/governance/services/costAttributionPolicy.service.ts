// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Resolves whether a tool's direct-OTLP usage is "non-billable" (bundled into
 * a subscription plan rather than billed per token), so the receiver can stamp
 * `langwatch.cost.non_billable` on ingest-key traces and the trace summary can
 * split billed vs non-billed cost.
 *
 * Source of truth: the org's coding-assistant catalog tile whose
 * `config.assistantKind` matches the ingest `sourceType`, reading
 * `config.bundledPlan`. Default TRUE for the OTLP/ingest path: coding
 * assistants usually run on a flat plan (e.g. Claude Max), so their list-price
 * token cost is theoretical, not real spend. An admin opts a tool back into
 * per-token billing by unticking "Bundled subscription" (bundledPlan === false).
 *
 * Gateway / virtual-key usage never reaches this path (it routes through a key
 * the customer pays per token) and is always billed.
 *
 * Per-(org, sourceType) results are cached in-process for 30s, mirroring
 * GovernanceContentStripService — the ingest path is bursty, so a brief window
 * sharply cuts Prisma load while keeping an admin's flip visible within ~30s.
 */
import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrismaClient } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:cost-attribution-policy");

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  nonBillable: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(organizationId: string, sourceType: string): string {
  return `${organizationId}::${sourceType}`;
}

export async function resolveSourceNonBillable({
  organizationId,
  sourceType,
  prisma = defaultPrismaClient,
}: {
  organizationId: string;
  sourceType: string;
  prisma?: PrismaClient;
}): Promise<boolean> {
  const key = cacheKey(organizationId, sourceType);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.nonBillable;

  // Default: the OTLP/ingest path is bundled (non-billable) unless an admin
  // explicitly unticked it on the matching coding-assistant tile.
  let nonBillable = true;
  try {
    const tiles = await prisma.aiToolEntry.findMany({
      where: {
        organizationId,
        type: "coding_assistant",
        enabled: true,
        archivedAt: null,
      },
      select: { config: true },
    });
    for (const tile of tiles) {
      const config = (tile.config ?? {}) as Record<string, unknown>;
      if (config.assistantKind === sourceType && config.bundledPlan === false) {
        nonBillable = false;
        break;
      }
    }
  } catch (error) {
    // Fail open to the default rather than block ingestion on a catalog read.
    logger.warn(
      { error, organizationId, sourceType },
      "failed to resolve bundled-plan policy; defaulting to non-billable",
    );
    nonBillable = true;
  }

  cache.set(key, { nonBillable, expiresAt: now + CACHE_TTL_MS });
  return nonBillable;
}

/** Test-only: drop the in-process cache between cases. */
export function __resetCostAttributionCacheForTests(): void {
  cache.clear();
}
