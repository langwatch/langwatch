// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Org ↔ governance tenant, as a persisted history rather than a live lookup
 * (ADR-128 §11).
 *
 * `resolveGovProjectId` answers "where do new rows go today". It cannot answer
 * "where has this organization ever written", because it filters
 * `archivedAt: null` and so returns null forever once somebody archives the
 * governance project — while the write path re-reads the same project by slug
 * with no such filter and keeps landing rows under the old tenant. The
 * organization would map to zero tenants on read and one on write: a permanent
 * split-brain in which the cost screen reports "no governance data" and an
 * erasure job erases nothing and reports success, indistinguishable from an
 * organization that never ingested anything.
 *
 * So the history is recorded the first time a tenant is used and never pruned.
 * The live resolver stays what it is, and stops being load-bearing for anything
 * historical.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

import { GovernanceTenantHistoryRepository } from "../repositories/governanceIdentity.repository";

const logger = createLogger("langwatch:governance:tenant-history");

const repository = new GovernanceTenantHistoryRepository();

/**
 * Records that this organization has written governance rows under this tenant.
 *
 * Touch-then-append rather than an upsert: the overwhelmingly common call is on
 * an already-recorded tenant, and that path is one indexed `UPDATE` with no
 * read in front of it. Only the genuine first use falls through to the insert.
 *
 * Never throws. A tenant that fails to record is a gap in the erasure walk,
 * which is serious — but it is not a reason to fail the ingest request that
 * happened to be the first one through the door, and the next request records
 * it. The error is logged loudly for exactly that reason.
 */
export async function recordGovernanceTenantUse({
  prisma,
  organizationId,
  tenantId,
  at = new Date(),
}: {
  prisma: PrismaClient;
  organizationId: string;
  tenantId: string;
  at?: Date;
}): Promise<void> {
  try {
    const touched = await repository.touch(prisma, {
      organizationId,
      tenantId,
      at,
    });
    if (touched) return;
    await repository.append(prisma, { organizationId, tenantId, at });
  } catch (error) {
    logger.error(
      { error, organizationId, tenantId },
      "Failed to record a governance tenant in the history; a later erasure could miss rows written under it",
    );
  }
}

/**
 * Every governance `TenantId` this organization has written rows under.
 *
 * The predicate erasure and org-wide reads must use. Falls back to nothing
 * rather than to the live project: an empty history and "the live project" are
 * different claims, and quietly substituting one for the other is how an
 * erasure reports success having walked the wrong tenant.
 */
export async function resolveGovTenantIds({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string[]> {
  const rows = await repository.findAllByOrganization(prisma, {
    organizationId,
  });
  return rows.map((row) => row.tenantId);
}

/**
 * The organization a governance tenant belongs to.
 *
 * The read-translate helper for call sites that hold a governance project id
 * and need to reach the identity tables, which are keyed by organization. Works
 * on an archived tenant, which is the entire reason it reads the history rather
 * than the project row.
 */
export async function resolveGovOrganizationId({
  prisma,
  tenantId,
}: {
  prisma: PrismaClient;
  tenantId: string;
}): Promise<string | null> {
  const row = await repository.findByTenantId(prisma, { tenantId });
  return row?.organizationId ?? null;
}
