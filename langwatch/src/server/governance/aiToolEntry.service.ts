/**
 * AiToolEntryService — owns the AI Tools Portal catalog (Phase 7).
 *
 * The portal lives at /me as a card grid (3 sections — coding
 * assistants, model providers, external tools) and is managed by org
 * admins at /settings/governance/tool-catalog.
 *
 * Scoping (read resolution):
 *   - org-scoped entries ("scope":"organization") are visible to ALL
 *     members of the org by default.
 *   - team-scoped entries ("scope":"team") are visible only to members
 *     of that team. A team-scoped entry with the same `slug` as an
 *     org-scoped entry OVERRIDES the org default for users in the team
 *     (admins use this to hide / re-skin a globally-listed tool per
 *     team).
 *
 * Per-type config schema (validated at create / update via zod
 * discriminated union — DB-level shape is `Json @default("{}")`):
 *
 *   coding_assistant: { setupCommand, setupDocsUrl, helperText? }
 *   model_provider:   { providerKey, suggestedRoutingPolicyId?,
 *                       defaultLabel?, projectSuggestionText? }
 *   external_tool:    { descriptionMarkdown, linkUrl, ctaLabel? }
 *
 * Authorisation: callers MUST gate on `aiTools:view` (read paths) or
 * `aiTools:manage` (write paths) BEFORE invoking these methods. The
 * service itself never checks RBAC — that's the router / route layer.
 *
 * Spec: specs/ai-governance/personal-portal/tool-catalog-*.feature
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

export const SUPPORTED_TILE_TYPES = [
  "coding_assistant",
  "model_provider",
  "external_tool",
] as const;
export type AiToolType = (typeof SUPPORTED_TILE_TYPES)[number];

export const SUPPORTED_SCOPES = ["organization", "team"] as const;
export type AiToolScope = (typeof SUPPORTED_SCOPES)[number];

const codingAssistantConfig = z.object({
  setupCommand: z.string().min(1).max(256),
  setupDocsUrl: z.string().url().max(2048),
  helperText: z.string().max(2048).optional(),
});

const modelProviderConfig = z.object({
  providerKey: z.string().min(1).max(64),
  suggestedRoutingPolicyId: z.string().min(1).optional(),
  defaultLabel: z.string().max(64).optional(),
  projectSuggestionText: z.string().max(512).optional(),
});

const externalToolConfig = z.object({
  descriptionMarkdown: z.string().max(8192),
  linkUrl: z.string().url().max(2048),
  ctaLabel: z.string().max(64).optional(),
});

export const AiToolConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("coding_assistant"), config: codingAssistantConfig }),
  z.object({ type: z.literal("model_provider"), config: modelProviderConfig }),
  z.object({ type: z.literal("external_tool"), config: externalToolConfig }),
]);

export type AiToolConfig = z.infer<typeof AiToolConfigSchema>["config"];

export interface AiToolEntryDto {
  id: string;
  organizationId: string;
  scope: AiToolScope;
  scopeId: string;
  type: AiToolType;
  displayName: string;
  slug: string;
  iconKey: string | null;
  order: number;
  enabled: boolean;
  config: Record<string, unknown>;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
}

function toDto(row: {
  id: string;
  organizationId: string;
  scope: string;
  scopeId: string;
  type: string;
  displayName: string;
  slug: string;
  iconKey: string | null;
  order: number;
  enabled: boolean;
  config: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
}): AiToolEntryDto {
  return {
    ...row,
    scope: row.scope as AiToolScope,
    type: row.type as AiToolType,
    config: (row.config as Record<string, unknown>) ?? {},
  };
}

export class AiToolEntryService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): AiToolEntryService {
    return new AiToolEntryService(prisma);
  }

  /**
   * User-facing list. Returns enabled, non-archived entries visible to
   * the calling user. Org-scoped entries are visible to all members;
   * team-scoped entries are filtered to the user's team memberships.
   * Team-scoped entries with the same `slug` as an org-scoped entry
   * SHADOW the org default (Vercel-style team-overrides-org pattern).
   *
   * Sorted by (order ASC, displayName ASC).
   */
  async listForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AiToolEntryDto[]> {
    // Resolve the user's team memberships in this org so we can filter
    // team-scoped entries. The legacy TeamUser table is the source of
    // truth (RoleBindings + groups land in a follow-up).
    const teamMemberships = await this.prisma.teamUser.findMany({
      where: { userId, team: { organizationId } },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((m) => m.teamId);

    const rows = await this.prisma.aiToolEntry.findMany({
      where: {
        organizationId,
        enabled: true,
        archivedAt: null,
        OR: [
          { scope: "organization", scopeId: organizationId },
          ...(teamIds.length > 0
            ? [{ scope: "team", scopeId: { in: teamIds } }]
            : []),
        ],
      },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
    });

    // Apply team-overrides-org by slug. We keep the team entry when
    // both exist; otherwise fall through to the org entry.
    const bySlug = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = bySlug.get(row.slug);
      if (!existing) {
        bySlug.set(row.slug, row);
        continue;
      }
      if (row.scope === "team" && existing.scope === "organization") {
        bySlug.set(row.slug, row);
      }
    }

    return Array.from(bySlug.values()).map(toDto);
  }

  /**
   * Admin list. Returns ALL entries (incl. disabled + archived) for
   * the catalog editor surface.
   */
  async listForAdmin({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AiToolEntryDto[]> {
    const rows = await this.prisma.aiToolEntry.findMany({
      where: { organizationId },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
    });
    return rows.map(toDto);
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<AiToolEntryDto | null> {
    const row = await this.prisma.aiToolEntry.findUnique({ where: { id } });
    if (!row || row.organizationId !== organizationId) return null;
    return toDto(row);
  }

  async create(input: {
    organizationId: string;
    scope: AiToolScope;
    scopeId: string;
    type: AiToolType;
    displayName: string;
    slug: string;
    iconKey?: string | null;
    order?: number;
    config: Record<string, unknown>;
    actorUserId?: string | null;
  }): Promise<AiToolEntryDto> {
    AiToolConfigSchema.parse({ type: input.type, config: input.config });

    const row = await this.prisma.aiToolEntry.create({
      data: {
        organizationId: input.organizationId,
        scope: input.scope,
        scopeId: input.scopeId,
        type: input.type,
        displayName: input.displayName,
        slug: input.slug,
        iconKey: input.iconKey ?? null,
        order: input.order ?? 0,
        enabled: true,
        config: input.config as Prisma.InputJsonValue,
        createdById: input.actorUserId ?? null,
        updatedById: input.actorUserId ?? null,
      },
    });
    return toDto(row);
  }

  async update(input: {
    id: string;
    organizationId: string;
    displayName?: string;
    iconKey?: string | null;
    order?: number;
    enabled?: boolean;
    type?: AiToolType;
    config?: Record<string, unknown>;
    actorUserId?: string | null;
  }): Promise<AiToolEntryDto> {
    const existing = await this.findById({
      id: input.id,
      organizationId: input.organizationId,
    });
    if (!existing) {
      throw new Error(
        `AiToolEntry ${input.id} not found in organization ${input.organizationId}`,
      );
    }

    if (input.config) {
      AiToolConfigSchema.parse({
        type: input.type ?? existing.type,
        config: input.config,
      });
    }

    const row = await this.prisma.aiToolEntry.update({
      where: { id: input.id },
      data: {
        displayName: input.displayName,
        iconKey: input.iconKey,
        order: input.order,
        enabled: input.enabled,
        type: input.type,
        config: input.config as Prisma.InputJsonValue | undefined,
        updatedById: input.actorUserId ?? null,
      },
    });
    return toDto(row);
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<AiToolEntryDto> {
    const existing = await this.findById({ id, organizationId });
    if (!existing) {
      throw new Error(
        `AiToolEntry ${id} not found in organization ${organizationId}`,
      );
    }
    const row = await this.prisma.aiToolEntry.update({
      where: { id },
      data: { archivedAt: new Date(), enabled: false },
    });
    return toDto(row);
  }

  /**
   * Bulk reorder. Admins drag-to-reorder in the catalog editor; the
   * client sends back the full ordered list of (id, order) pairs and
   * we apply them in a transaction so a partial failure doesn't leave
   * the grid in a half-renumbered state.
   */
  async reorder({
    organizationId,
    updates,
  }: {
    organizationId: string;
    updates: Array<{ id: string; order: number }>;
  }): Promise<void> {
    await this.prisma.$transaction(
      updates.map(({ id, order }) =>
        this.prisma.aiToolEntry.updateMany({
          where: { id, organizationId },
          data: { order },
        }),
      ),
    );
  }
}
