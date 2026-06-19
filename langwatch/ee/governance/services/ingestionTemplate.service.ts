// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * IngestionTemplateService — owns the catalog read + admin-authoring
 * surface for the personal-project trace-ingest flow.
 *
 * Read paths return platform-published rows (organizationId IS NULL)
 * unioned with the caller's org-authored rows. Authoring lets an org
 * admin create custom templates, edit OTTL on rows they own, and
 * archive them. Platform rows stay read-only — admins clone them via
 * `cloneFromPlatform` to customise.
 *
 * Spec: specs/ai-gateway/governance/ingestion-templates-catalog.feature
 *       specs/ai-governance/admin-ottl-authoring.feature
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid";

import { GovernanceAuditRepository } from "../repositories/governanceAudit.repository";
import { IngestionTemplateRepository } from "../repositories/ingestionTemplate.repository";
import {
  DEFAULT_GOVERNANCE_SURFACE,
  type GovernanceCallSurface,
} from "./auditSurface";
import { seedPlatformIngestionTemplates } from "./platformIngestionTemplates.seeds";

import { createLogger } from "~/utils/logger/server";

const slugSuffixGenerator = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  6,
);
const generateSlugSuffix = () => slugSuffixGenerator();

const logger = createLogger("langwatch:governance:ingestion-template");

const SOURCE_TYPE_PATTERN = /^[a-z0-9_]{1,40}$/;

export class PlatformTemplateImmutableError extends Error {
  constructor() {
    super(
      "Platform-published templates are read-only. Clone to your organization to customize.",
    );
    this.name = "PlatformTemplateImmutableError";
  }
}

export class TemplateNotFoundError extends Error {
  constructor() {
    super("Ingestion template not found.");
    this.name = "TemplateNotFoundError";
  }
}

export class InvalidSourceTypeError extends Error {
  constructor() {
    super(
      "sourceType must be lowercase letters / digits / underscores, max 40 chars.",
    );
    this.name = "InvalidSourceTypeError";
  }
}

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

function rowFromPrisma(
  r: Prisma.IngestionTemplateGetPayload<Record<string, never>>,
): IngestionTemplateRow {
  return {
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
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").filter((s) => s.trim().length > 0).length;
}

export class IngestionTemplateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: IngestionTemplateRepository = new IngestionTemplateRepository(),
    private readonly auditRepo: GovernanceAuditRepository = new GovernanceAuditRepository(),
  ) {}

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
    const rows = await this.repo.findUserVisibleForOrg(this.prisma, {
      organizationId,
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
    const rows = await this.repo.findAdminVisibleForOrg(this.prisma, {
      organizationId,
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
    const row = await this.repo.findByIdForOrg(this.prisma, {
      id,
      organizationId,
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
   * Admin authors a brand-new ingestion template scoped to their org.
   * Slug is auto-generated from displayName + nanoid suffix to satisfy
   * the `(organizationId, slug)` unique constraint without forcing
   * admins to invent stable identifiers. Audit logged with
   * `gateway.ingestion_template.created`.
   */
  async createOrgTemplate({
    organizationId,
    callerUserId,
    sourceType,
    displayName,
    description,
    iconAsset,
    credentialSchema,
    ottlRules,
    surface,
  }: {
    organizationId: string;
    callerUserId: string;
    sourceType: string;
    displayName: string;
    description?: string | null;
    iconAsset?: string | null;
    credentialSchema?: string | null;
    ottlRules?: string;
    /** Audit-trail attribution per umbrella spec @audit-uniform. */
    surface?: GovernanceCallSurface;
  }): Promise<IngestionTemplateRow> {
    if (!SOURCE_TYPE_PATTERN.test(sourceType)) {
      throw new InvalidSourceTypeError();
    }
    const slugBase = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    const slug = `${slugBase || "custom"}_${generateSlugSuffix()}`;

    return await this.prisma.$transaction(async (tx) => {
      const created = await this.repo.create(tx, {
        organizationId,
        slug,
        sourceType,
        displayName,
        description: description ?? null,
        iconAsset: iconAsset ?? null,
        credentialSchema: credentialSchema ?? null,
        ottlRules: ottlRules ?? "",
        platformPublished: false,
        enabled: true,
        createdById: callerUserId,
        updatedById: callerUserId,
      });

      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        organizationId,
        action: "gateway.ingestion_template.created",
        targetKind: "ingestion_template",
        targetId: created.id,
        metadata: {
          slug: created.slug,
          sourceType: created.sourceType,
          displayName: created.displayName,
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
        },
      });

      return rowFromPrisma(created);
    });
  }

  /**
   * Replace `ottlRules` on an org-authored template. Platform-published
   * rows reject the call with `PlatformTemplateImmutableError` — admins
   * must clone first. Audit-logged with diff metadata so a forensic
   * reader can answer "who flipped the OTTL last week".
   */
  async updateOttlRules({
    organizationId,
    callerUserId,
    id,
    ottlRules,
    surface,
  }: {
    organizationId: string;
    callerUserId: string;
    id: string;
    ottlRules: string;
    surface?: GovernanceCallSurface;
  }): Promise<IngestionTemplateRow> {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findOrgScopedNonArchived(tx, {
        id,
        organizationId,
        select: {
          id: true,
          slug: true,
          ottlRules: true,
          platformPublished: true,
        },
      });
      if (!existing) throw new TemplateNotFoundError();
      if (existing.platformPublished) {
        throw new PlatformTemplateImmutableError();
      }

      const updated = await this.repo.updateById(tx, {
        id: existing.id,
        data: { ottlRules, updatedById: callerUserId },
      });

      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        organizationId,
        action: "gateway.ingestion_template.ottl_updated",
        targetKind: "ingestion_template",
        targetId: existing.id,
        metadata: {
          slug: existing.slug,
          previousLineCount: countLines(existing.ottlRules ?? ""),
          nextLineCount: countLines(ottlRules),
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
        },
      });

      return rowFromPrisma(updated);
    });
  }

  /**
   * Soft-archive an org-authored template. Sets archivedAt; existing
   * ingestion keys continue to land traces (per the v1 `enabled=false`
   * semantics in the schema doc), but the row is removed from admin +
   * user list views. Platform rows reject.
   */
  async archiveOrgTemplate({
    organizationId,
    callerUserId,
    id,
    surface,
  }: {
    organizationId: string;
    callerUserId: string;
    id: string;
    surface?: GovernanceCallSurface;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findOrgScopedNonArchived(tx, {
        id,
        organizationId,
        select: { id: true, slug: true, platformPublished: true },
      });
      if (!existing) throw new TemplateNotFoundError();
      if (existing.platformPublished) {
        throw new PlatformTemplateImmutableError();
      }

      await this.repo.updateById(tx, {
        id: existing.id,
        data: {
          archivedAt: new Date(),
          enabled: false,
          updatedById: callerUserId,
        },
      });

      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        organizationId,
        action: "gateway.ingestion_template.archived",
        targetKind: "ingestion_template",
        targetId: existing.id,
        metadata: {
          slug: existing.slug,
          surface: surface ?? DEFAULT_GOVERNANCE_SURFACE,
        },
      });
    });
  }

  /**
   * Clone a platform-published template into the caller's org so the
   * admin can edit OTTL / displayName / etc. The cloned row is
   * org-authored (platformPublished=false), keeps the same sourceType
   * and credentialSchema, and starts with the platform OTTL rules. The
   * clone is otherwise a fresh row — slug regenerated, no carryover
   * ingestion keys (those continue to point at the platform original).
   */
  async cloneFromPlatform({
    organizationId,
    callerUserId,
    sourceTemplateId,
    surface,
  }: {
    organizationId: string;
    callerUserId: string;
    sourceTemplateId: string;
    surface?: GovernanceCallSurface;
  }): Promise<IngestionTemplateRow> {
    const source = await this.repo.findPlatformNonArchivedById(this.prisma, {
      id: sourceTemplateId,
    });
    if (!source) throw new TemplateNotFoundError();

    return await this.createOrgTemplate({
      organizationId,
      callerUserId,
      sourceType: source.sourceType,
      displayName: `${source.displayName} (custom)`,
      description: source.description,
      iconAsset: source.iconAsset,
      credentialSchema: source.credentialSchema,
      ottlRules: source.ottlRules,
      surface,
    });
  }

  /**
   * Reusable shape converter — used by the new authoring methods that
   * need to return the same `IngestionTemplateRow` shape as the read
   * methods.
   */
  static rowFromPrisma(
    r: Prisma.IngestionTemplateGetPayload<Record<string, never>>,
  ): IngestionTemplateRow {
    return rowFromPrisma(r);
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
