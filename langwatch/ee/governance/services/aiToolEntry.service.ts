// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
  // Drawer labels "Setup docs URL (optional)" and only includes the
  // field in the wire payload when filled. Schema must match — when
  // required, every catalog publish 400'd with `Required` (Ariana QA
  // admin-hat #2). Type label says optional, behavior should too.
  setupDocsUrl: z.string().url().max(2048).optional(),
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

/**
 * The starter pack documented in docs/ai-governance/personal-portal/
 * admin-catalog.mdx §"Starter pack" — a sensible default set that gives
 * a fresh org an immediately useful /me portal grid. Coding assistants
 * point at the `langwatch <tool>` device-flow command; model providers
 * carry a `providerKey` slug so the user-side click-to-expand can mint
 * a personal VK against the right backend without further admin input.
 *
 * External tools deliberately omitted — admins fill those in per-org
 * with internal links (no useful default exists across orgs).
 */
const STARTER_PACK_TILES: ReadonlyArray<{
  type: AiToolType;
  slug: string;
  displayName: string;
  iconKey?: string;
  config: Record<string, unknown>;
}> = [
  {
    type: "coding_assistant",
    slug: "claude-code",
    displayName: "Claude Code",
    iconKey: "claude-code",
    config: {
      setupCommand: "langwatch claude",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
      helperText: "Run from your terminal to provision a VK and launch Claude Code.",
    },
  },
  {
    type: "coding_assistant",
    slug: "copilot",
    displayName: "GitHub Copilot",
    iconKey: "copilot",
    config: {
      setupCommand: "langwatch copilot",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "cursor",
    displayName: "Cursor",
    iconKey: "cursor",
    config: {
      setupCommand: "langwatch cursor",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "codex",
    displayName: "Codex",
    iconKey: "codex",
    config: {
      setupCommand: "langwatch codex",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "model_provider",
    slug: "openai",
    displayName: "OpenAI",
    iconKey: "openai",
    config: {
      // Label must satisfy the personalVirtualKeys.issuePersonal regex
      // (^[a-z0-9][a-z0-9_\-]*$) — Ariana caught the original
      // "OpenAI key" defaults pre-filling a value that immediately
      // failed validation. Keep the shape lowercase + dash so the user
      // can submit without editing.
      providerKey: "openai",
      defaultLabel: "openai-key",
      projectSuggestionText:
        "Building an app? Create a project to track its usage separately.",
    },
  },
  {
    type: "model_provider",
    slug: "anthropic",
    displayName: "Anthropic",
    iconKey: "anthropic",
    config: {
      providerKey: "anthropic",
      defaultLabel: "anthropic-key",
    },
  },
  {
    type: "model_provider",
    slug: "bedrock",
    displayName: "AWS Bedrock",
    iconKey: "bedrock",
    config: {
      providerKey: "bedrock",
      defaultLabel: "bedrock-key",
    },
  },
  {
    type: "model_provider",
    slug: "gemini",
    displayName: "Google Gemini",
    iconKey: "gemini",
    config: {
      providerKey: "gemini",
      defaultLabel: "gemini-key",
    },
  },
];

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
   * Seed the documented starter pack onto an org's catalog (Phase 7
   * "fresh-org friction killer" per docs/ai-governance/personal-portal/
   * admin-catalog.mdx). Idempotent: skips any tile whose `slug` is
   * already published as an org-scoped entry — admins who already
   * curated their catalog by hand and then click "Import starter pack"
   * just get filled-in gaps, never duplicates or re-skinned tiles.
   *
   * Returns the count of tiles actually created so the UI can report
   * "imported N tiles" or "starter pack already in place" correctly.
   */
  async seedStarterPack(input: {
    organizationId: string;
    actorUserId?: string | null;
  }): Promise<{ created: number; skipped: number }> {
    const existing = await this.prisma.aiToolEntry.findMany({
      where: {
        organizationId: input.organizationId,
        scope: "organization",
        scopeId: input.organizationId,
      },
      select: { slug: true },
    });
    const taken = new Set(existing.map((e) => e.slug));

    const tiles = STARTER_PACK_TILES.filter((t) => !taken.has(t.slug));
    if (tiles.length === 0) {
      return { created: 0, skipped: STARTER_PACK_TILES.length };
    }

    await this.prisma.$transaction(
      tiles.map((tile, index) =>
        this.prisma.aiToolEntry.create({
          data: {
            organizationId: input.organizationId,
            scope: "organization",
            scopeId: input.organizationId,
            type: tile.type,
            displayName: tile.displayName,
            slug: tile.slug,
            iconKey: tile.iconKey ?? null,
            // Append after any tiles the admin already created — keeps
            // their hand-curated order on top.
            order: existing.length + index,
            enabled: true,
            config: tile.config as Prisma.InputJsonValue,
            createdById: input.actorUserId ?? null,
            updatedById: input.actorUserId ?? null,
          },
        }),
      ),
    );

    return {
      created: tiles.length,
      skipped: STARTER_PACK_TILES.length - tiles.length,
    };
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
