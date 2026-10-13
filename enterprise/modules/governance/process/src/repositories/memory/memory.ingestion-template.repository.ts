// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceCallSurface,
  IngestionTemplate,
  PlatformIngestionTemplateSeed,
  PlatformIngestionTemplateSyncResult,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";

import {
  IngestionTemplateRepository,
  type IngestionTemplateMutationResult,
  type NewIngestionTemplate,
} from "../ingestion-template.repository.ts";
import type { MemoryGovernanceStore } from "./memory.governance.store.ts";

const INGESTION_TEMPLATE_KSUID_RESOURCE = "ingtmpl";

/**
 * The ingestion-template twin. One array behind every row, the way the
 * Prisma tier's `ingestionTemplate` table is one table behind every row: a
 * platform row carries `organizationId: null`, and a caller-authored row
 * carries the organization that authored it — the same column the Prisma
 * repository filters on.
 *
 * Archiving is tracked beside the array rather than as a domain field,
 * because {@link IngestionTemplate} carries no `archivedAt` — only the
 * Prisma-tier row does. A template that has been archived stays in the array
 * (so `findPlatform`/audit-style lookups by id keep working if ever needed)
 * but drops out of every `*Visible` read the same way the Prisma repository's
 * `archivedAt: null` predicate excludes it.
 */
export class MemoryIngestionTemplateRepository extends IngestionTemplateRepository {
  private readonly archivedIds = new Set<string>();

  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryIngestionTemplateRepository {
    return new MemoryIngestionTemplateRepository(store);
  }

  async findUserVisible(organizationId: string): Promise<IngestionTemplate[]> {
    return this.visibleTo(organizationId)
      .filter((template) => template.enabled)
      .toSorted(byPlatformThenDisplayName);
  }

  async findAdminVisible(organizationId: string): Promise<IngestionTemplate[]> {
    return this.visibleTo(organizationId).toSorted(byPlatformThenDisplayName);
  }

  async findVisible(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null> {
    return (
      this.visibleTo(input.organizationId).find((template) => template.id === input.id) ?? null
    );
  }

  async findPlatform(id: string): Promise<IngestionTemplate | null> {
    return (
      this.store.ingestionTemplates.find(
        (template) =>
          template.id === id && template.organizationId === null && !this.archivedIds.has(id),
      ) ?? null
    );
  }

  async createWithAudit(input: {
    template: NewIngestionTemplate;
    callerUserId: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplate> {
    const created: IngestionTemplate = {
      ...input.template,
      id: generate(INGESTION_TEMPLATE_KSUID_RESOURCE).toString(),
      platformPublished: false,
      enabled: true,
    };
    this.store.ingestionTemplates.push(created);
    return created;
  }

  async updateOttlRulesWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    ottlRules: string;
    surface: GovernanceCallSurface;
  }): Promise<IngestionTemplateMutationResult> {
    const existing = this.mutableCandidate(input);
    if (!existing) return { status: "not_found" };
    if (existing.organizationId === null) return { status: "platform" };

    existing.ottlRules = input.ottlRules;
    return { status: "updated", template: existing };
  }

  async archiveWithAudit(input: {
    id: string;
    organizationId: string;
    callerUserId: string;
    surface: GovernanceCallSurface;
    archivedAt: Instant;
  }): Promise<IngestionTemplateMutationResult> {
    const existing = this.mutableCandidate(input);
    if (!existing) return { status: "not_found" };
    if (existing.organizationId === null) return { status: "platform" };

    existing.enabled = false;
    this.archivedIds.add(existing.id);
    return { status: "updated", template: existing };
  }

  async syncPlatformCatalog(input: {
    templates: readonly PlatformIngestionTemplateSeed[];
    retiredSlugs: readonly string[];
    archivedAt: Instant;
  }): Promise<PlatformIngestionTemplateSyncResult> {
    let created = 0;
    let updated = 0;
    let archived = 0;

    for (const seed of input.templates) {
      const existing = this.store.ingestionTemplates.find(
        (template) => template.organizationId === null && template.slug === seed.slug,
      );
      if (existing) {
        Object.assign(existing, seed, { platformPublished: true, enabled: true });
        this.archivedIds.delete(existing.id);
        updated += 1;
      } else {
        this.store.ingestionTemplates.push({
          ...seed,
          id: generate(INGESTION_TEMPLATE_KSUID_RESOURCE).toString(),
          organizationId: null,
          platformPublished: true,
          enabled: true,
        });
        created += 1;
      }
    }

    for (const slug of input.retiredSlugs) {
      for (const template of this.store.ingestionTemplates) {
        if (
          template.organizationId === null &&
          template.slug === slug &&
          !this.archivedIds.has(template.id)
        ) {
          template.enabled = false;
          this.archivedIds.add(template.id);
          archived += 1;
        }
      }
    }

    return { created, updated, archived };
  }

  private visibleTo(organizationId: string): IngestionTemplate[] {
    return this.store.ingestionTemplates.filter(
      (template) =>
        !this.archivedIds.has(template.id) &&
        (template.organizationId === null || template.organizationId === organizationId),
    );
  }

  private mutableCandidate(input: {
    id: string;
    organizationId: string;
  }): IngestionTemplate | null {
    return (
      this.visibleTo(input.organizationId).find((template) => template.id === input.id) ?? null
    );
  }
}

function byPlatformThenDisplayName(a: IngestionTemplate, b: IngestionTemplate): number {
  if (a.platformPublished !== b.platformPublished) return a.platformPublished ? -1 : 1;
  return a.displayName.localeCompare(b.displayName);
}
