// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * IngestionTemplateService — owns the catalog read surface for the v1
 * personal-project trace-ingest flow.
 *
 * v1 surfaces only platform-published templates (organizationId IS NULL).
 * Org-authored authoring lands v2 — the schema column is in place and
 * `listForOrgAdmin` already merges org-authored rows when they exist,
 * so admin UI for that path can ship without a service-side change.
 *
 * Spec: specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import type { PrismaClient } from "@prisma/client";

import { seedPlatformIngestionTemplates } from "./platformIngestionTemplates.seeds";

import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:governance:ingestion-template");

/**
 * Once-per-process flag for lazy platform-template seeding. Lets the
 * docker dev environment auto-seed on first `listForUser` call rather
 * than depending on an explicit `pnpm tsx scripts/seed-...` run that
 * developers forget. Idempotent at the DB level too (the seeder
 * upserts), so concurrent requests are safe.
 */
let lazySeedPromise: Promise<void> | null = null;

export interface IngestionTemplateRow {
  id: string;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
  organizationId: string | null;
}

export class IngestionTemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): IngestionTemplateService {
    return new IngestionTemplateService(prisma);
  }

  /**
   * User-facing catalog for `/me Trace Ingest`. Returns the union of
   * platform-published defaults (`organizationId IS NULL`) and any
   * org-authored rows on the caller's organization. Disabled + archived
   * rows are filtered out.
   *
   * `ottlRules` is intentionally OMITTED from the user-facing shape —
   * end users see the install copy + snippet, never the OTTL source.
   *
   * Lazy-seeds the platform default catalog on first call per process —
   * docker dev environments don't need an explicit
   * `pnpm tsx scripts/seed-platform-ingestion-templates.ts` step, and
   * production environments converge to the locked v1 catalog the first
   * time anyone hits /me Trace Ingest. Idempotent at the DB layer.
   */
  async listForUser({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IngestionTemplateRow[]> {
    await this.ensurePlatformDefaultsSeeded();
    const rows = await this.prisma.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        enabled: true,
        OR: [
          { organizationId: null },
          { organizationId },
        ],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      sourceType: r.sourceType,
      displayName: r.displayName,
      description: r.description,
      iconAsset: r.iconAsset,
      credentialSchema: r.credentialSchema,
      // User-facing list returns ottlRules as empty string — not load-
      // bearing for the install drawer, and platform OTTL is internal
      // implementation detail.
      ottlRules: "",
      platformPublished: r.platformPublished,
      enabled: r.enabled,
      organizationId: r.organizationId,
    }));
  }

  /**
   * Admin catalog read — returns the same union as `listForUser` but
   * INCLUDES `ottlRules` so the admin READ-ONLY view at
   * `/settings/ai-tools → Ingestion Templates` can render the canonical
   * OTTL transparency block.
   *
   * Admin authoring (mutate ottlRules / platformPublished / etc.) is
   * deferred to v2; this method is read-only by design v1.
   */
  async listForOrgAdmin({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IngestionTemplateRow[]> {
    await this.ensurePlatformDefaultsSeeded();
    const rows = await this.prisma.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        OR: [
          { organizationId: null },
          { organizationId },
        ],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      sourceType: r.sourceType,
      displayName: r.displayName,
      description: r.description,
      iconAsset: r.iconAsset,
      credentialSchema: r.credentialSchema,
      ottlRules: r.ottlRules,
      platformPublished: r.platformPublished,
      enabled: r.enabled,
      organizationId: r.organizationId,
    }));
  }

  /**
   * Lookup by id, with cross-org isolation: callers can only resolve
   * platform-published rows OR rows on their own org. Cross-org probes
   * collapse to `null` (no enumeration vector).
   */
  async findByIdForOrg({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplateRow | null> {
    const row = await this.prisma.ingestionTemplate.findFirst({
      where: {
        id,
        archivedAt: null,
        OR: [
          { organizationId: null },
          { organizationId },
        ],
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      sourceType: row.sourceType,
      displayName: row.displayName,
      description: row.description,
      iconAsset: row.iconAsset,
      credentialSchema: row.credentialSchema,
      ottlRules: row.ottlRules,
      platformPublished: row.platformPublished,
      enabled: row.enabled,
      organizationId: row.organizationId,
    };
  }

  /**
   * Lazy-seed the platform-default catalog on first call per process.
   * Idempotent (the seeder upserts); concurrent calls share the same
   * promise. Errors are logged but NOT thrown — a transient seeding
   * failure shouldn't block the catalog read for users who already
   * have rows in the DB.
   */
  private async ensurePlatformDefaultsSeeded(): Promise<void> {
    if (lazySeedPromise) {
      await lazySeedPromise;
      return;
    }
    lazySeedPromise = (async () => {
      try {
        const result = await seedPlatformIngestionTemplates(this.prisma);
        if (result.created > 0 || result.archived > 0) {
          logger.info(
            { created: result.created, updated: result.updated, archived: result.archived },
            "platform IngestionTemplate catalog seeded on first request",
          );
        }
      } catch (err) {
        logger.error({ err }, "lazy seeding of platform IngestionTemplates failed");
        // Reset so the next call retries instead of caching the failure.
        lazySeedPromise = null;
      }
    })();
    await lazySeedPromise;
  }
}
