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
import { nanoid } from "nanoid";
import { z } from "zod";

import { modelProviders as supportedModelProviders } from "~/server/modelProviders/registry";

export const SUPPORTED_TILE_TYPES = [
  "coding_assistant",
  "model_provider",
  "external_tool",
] as const;
export type AiToolType = (typeof SUPPORTED_TILE_TYPES)[number];

export const SUPPORTED_SCOPES = ["organization", "team"] as const;
export type AiToolScope = (typeof SUPPORTED_SCOPES)[number];

/**
 * Fixed list of well-known coding-assistant kinds the drawer surfaces
 * with first-class icons + helper copy. `custom` lets the admin pin a
 * one-off assistant (internal tool, hand-rolled wrapper) without us
 * shipping a code change.
 */
export const SUPPORTED_ASSISTANT_KINDS = [
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "github_copilot",
  "custom",
] as const;
export type AssistantKind = (typeof SUPPORTED_ASSISTANT_KINDS)[number];

const codingAssistantConfig = z.object({
  /// Discriminator inside config so the drawer can render the matching
  /// preset icon + setup hints. Required for new writes; existing rows
  /// without it default to "custom" at read time.
  assistantKind: z.enum(SUPPORTED_ASSISTANT_KINDS).optional(),
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
  /// @deprecated Use `teamIds` instead. Populated for back-compat
  /// with pre-multi-team rows; mirrors `teamIds` at write time
  /// (`organization` when empty, `team` with first id when 1+).
  scope: AiToolScope;
  /// @deprecated Use `teamIds` instead. Mirrors `teamIds` for
  /// back-compat — see `scope` above.
  scopeId: string;
  /// Multi-team scope. Empty array = org-wide. Non-empty =
  /// visible only to members of those teams.
  teamIds: string[];
  type: AiToolType;
  displayName: string;
  slug: string;
  /// @deprecated Use `iconAsset` — kept for back-compat with
  /// pre-refactor rows.
  iconKey: string | null;
  /// Prefix-discriminated icon source:
  ///   "preset:<kind>"        — built-in icon
  ///   "data:image/...;base64,..." — admin-uploaded
  ///   null                    — UI falls back to type default
  iconAsset: string | null;
  order: number;
  enabled: boolean;
  config: Record<string, unknown>;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
}

interface AiToolEntryRow {
  id: string;
  organizationId: string;
  scope: string;
  scopeId: string;
  type: string;
  displayName: string;
  slug: string;
  iconKey: string | null;
  iconAsset: string | null;
  order: number;
  enabled: boolean;
  config: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  teams?: { teamId: string }[];
}

function toDto(row: AiToolEntryRow): AiToolEntryDto {
  const teamIds =
    row.teams?.map((t) => t.teamId) ??
    (row.scope === "team" && row.scopeId ? [row.scopeId] : []);
  return {
    ...row,
    scope: row.scope as AiToolScope,
    type: row.type as AiToolType,
    teamIds,
    config: (row.config as Record<string, unknown>) ?? {},
  };
}

/**
 * Slugify + suffix with a short nanoid so concurrent admins with
 * the same displayName never collide on the (organizationId, slug)
 * read path. Server-owned: clients cannot supply slug.
 */
function generateSlug(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stem = base.length > 0 ? base : "tool";
  return `${stem}-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/**
 * Mirror the new `teamIds[]` shape onto the legacy `scope`/`scopeId`
 * pair so any reader still hitting those columns sees a coherent row.
 *   []           → scope='organization', scopeId=organizationId
 *   [t]          → scope='team',         scopeId=t
 *   [t, ...]     → scope='team',         scopeId=teams[0]   (best
 *                  effort — multi-team can't be represented in the
 *                  legacy pair; readers should prefer teams[]).
 * Drops out of the service public API as soon as scope/scopeId are
 * removed in the follow-up migration.
 */
/**
 * Pretty label for the admin drawer's provider dropdown. Falls back
 * to a Title-Cased rendering of the provider key when not explicitly
 * mapped — covers custom / future providers without a code change.
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
  bedrock: "AWS Bedrock",
  google: "Google AI",
  google_vertex_ai: "Google Vertex AI",
  groq: "Groq",
  cloudflare: "Cloudflare AI",
  deepseek: "DeepSeek",
  cerebras: "Cerebras",
  custom: "Custom",
};

function providerDisplayName(providerKey: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[providerKey] ??
    providerKey
      .split(/[_\-\s]+/)
      .map((s) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s))
      .join(" ")
  );
}

function legacyScopeFromTeamIds({
  organizationId,
  teamIds,
}: {
  organizationId: string;
  teamIds: string[];
}): { scope: AiToolScope; scopeId: string } {
  if (teamIds.length === 0) {
    return { scope: "organization", scopeId: organizationId };
  }
  return { scope: "team", scopeId: teamIds[0]! };
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
  iconAsset: string;
  config: Record<string, unknown>;
}> = [
  {
    type: "coding_assistant",
    slug: "claude-code",
    displayName: "Claude Code",
    iconAsset: "preset:claude_code",
    config: {
      assistantKind: "claude_code",
      setupCommand: "langwatch claude",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "cursor",
    displayName: "Cursor",
    iconAsset: "preset:cursor",
    config: {
      assistantKind: "cursor",
      setupCommand: "langwatch cursor",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "codex",
    displayName: "Codex",
    iconAsset: "preset:codex",
    config: {
      assistantKind: "codex",
      setupCommand: "langwatch codex",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "coding_assistant",
    slug: "gemini",
    displayName: "Gemini CLI",
    iconAsset: "preset:gemini",
    config: {
      assistantKind: "gemini",
      setupCommand: "langwatch gemini",
      setupDocsUrl:
        "https://docs.langwatch.ai/ai-governance/personal-portal/end-user",
    },
  },
  {
    type: "model_provider",
    slug: "openai",
    displayName: "OpenAI",
    iconAsset: "preset:openai",
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
    iconAsset: "preset:anthropic",
    config: {
      providerKey: "anthropic",
      defaultLabel: "anthropic-key",
    },
  },
  {
    type: "model_provider",
    slug: "bedrock",
    displayName: "AWS Bedrock",
    iconAsset: "preset:bedrock",
    config: {
      providerKey: "bedrock",
      defaultLabel: "bedrock-key",
    },
  },
  {
    type: "model_provider",
    slug: "google",
    displayName: "Google AI",
    iconAsset: "preset:google",
    config: {
      providerKey: "google",
      defaultLabel: "google-key",
    },
  },
];

export class AiToolEntryService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): AiToolEntryService {
    return new AiToolEntryService(prisma);
  }

  /**
   * The starter-pack catalog the admin editor renders as a checklist so
   * the admin picks which tools to publish instead of importing the whole
   * set. Display-only projection of {@link STARTER_PACK_TILES}.
   */
  static listStarterPackTiles(): {
    slug: string;
    displayName: string;
    type: AiToolType;
  }[] {
    return STARTER_PACK_TILES.map((t) => ({
      slug: t.slug,
      displayName: t.displayName,
      type: t.type,
    }));
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
    const userTeamIds = teamMemberships.map((m) => m.teamId);

    // Pull every active row in the org with its team bindings
    // pre-joined; we filter visibility in JS so the team-overrides-org
    // shadow is straightforward to express. Cardinality is per-org-
    // catalog (~dozens), so the simpler shape outweighs a smarter
    // SQL filter here.
    const rows = await this.prisma.aiToolEntry.findMany({
      where: { organizationId, enabled: true, archivedAt: null },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
      include: { teams: { select: { teamId: true } } },
    });

    const userTeamSet = new Set(userTeamIds);
    const visible = rows.filter((row) => {
      // New shape: AiToolEntryTeam[] is the source of truth.
      if (row.teams.length > 0) {
        return row.teams.some((t) => userTeamSet.has(t.teamId));
      }
      // Back-compat for rows still written with legacy scope/scopeId
      // (Stage A migration only backfilled team-scoped rows into the
      // join table; org-scoped rows have an empty teams[] AND a
      // populated scope='organization'). Empty teams[] + scope='team'
      // means a hand-edited row — fall through to the legacy check.
      if (row.scope === "team") {
        return userTeamSet.has(row.scopeId);
      }
      // scope='organization' (or missing) → org-wide.
      return true;
    });

    // Apply team-overrides-org by slug. A team-bound entry shadows
    // an org-wide entry with the same slug for users in that team.
    const bySlug = new Map<string, (typeof visible)[number]>();
    for (const row of visible) {
      const existing = bySlug.get(row.slug);
      if (!existing) {
        bySlug.set(row.slug, row);
        continue;
      }
      const rowIsTeamBound = row.teams.length > 0 || row.scope === "team";
      const existingIsTeamBound =
        existing.teams.length > 0 || existing.scope === "team";
      if (rowIsTeamBound && !existingIsTeamBound) {
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
      include: { teams: { select: { teamId: true } } },
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
    const row = await this.prisma.aiToolEntry.findUnique({
      where: { id },
      include: { teams: { select: { teamId: true } } },
    });
    if (!row || row.organizationId !== organizationId) return null;
    return toDto(row);
  }

  async create(input: {
    organizationId: string;
    /// Empty array = org-wide (visible to every member). Non-empty
    /// = entry visible only to members of those teams.
    teamIds: string[];
    type: AiToolType;
    displayName: string;
    /// Optional iconAsset — "preset:<kind>" for built-in icons or
    /// a base64 data URL for admin-uploaded SVG/PNG. UI falls back
    /// to a type-default when null.
    iconAsset?: string | null;
    order?: number;
    config: Record<string, unknown>;
    actorUserId?: string | null;
  }): Promise<AiToolEntryDto> {
    AiToolConfigSchema.parse({ type: input.type, config: input.config });

    // Validate referenced teams belong to the calling org. Without
    // this an admin could bind a tile to a team in a foreign org and
    // cause cross-org visibility leaks.
    if (input.teamIds.length > 0) {
      const validTeams = await this.prisma.team.count({
        where: {
          id: { in: input.teamIds },
          organizationId: input.organizationId,
        },
      });
      if (validTeams !== input.teamIds.length) {
        throw new Error("One or more teams do not belong to this organization");
      }
    }

    // Back-compat mirror to scope/scopeId so any reader still hitting
    // the legacy columns sees a coherent row. Stage 2 will drop both.
    const { scope, scopeId } = legacyScopeFromTeamIds({
      organizationId: input.organizationId,
      teamIds: input.teamIds,
    });

    const slug = generateSlug(input.displayName);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiToolEntry.create({
        data: {
          organizationId: input.organizationId,
          scope,
          scopeId,
          type: input.type,
          displayName: input.displayName,
          slug,
          iconAsset: input.iconAsset ?? null,
          order: input.order ?? 0,
          enabled: true,
          config: input.config as Prisma.InputJsonValue,
          createdById: input.actorUserId ?? null,
          updatedById: input.actorUserId ?? null,
        },
      });
      if (input.teamIds.length > 0) {
        await tx.aiToolEntryTeam.createMany({
          data: input.teamIds.map((teamId) => ({
            entryId: created.id,
            teamId,
          })),
        });
      }
      return await tx.aiToolEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: { teams: { select: { teamId: true } } },
      });
    });
    return toDto(row);
  }

  async update(input: {
    id: string;
    organizationId: string;
    displayName?: string;
    iconAsset?: string | null;
    /// Pass to overwrite the team binding set. Empty = org-wide.
    /// Omit to leave the existing binding untouched.
    teamIds?: string[];
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

    if (input.teamIds && input.teamIds.length > 0) {
      const validTeams = await this.prisma.team.count({
        where: {
          id: { in: input.teamIds },
          organizationId: input.organizationId,
        },
      });
      if (validTeams !== input.teamIds.length) {
        throw new Error("One or more teams do not belong to this organization");
      }
    }

    const legacyMirror =
      input.teamIds !== undefined
        ? legacyScopeFromTeamIds({
            organizationId: input.organizationId,
            teamIds: input.teamIds,
          })
        : null;

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.aiToolEntry.update({
        where: { id: input.id },
        data: {
          displayName: input.displayName,
          iconAsset: input.iconAsset,
          order: input.order,
          enabled: input.enabled,
          type: input.type,
          config: input.config as Prisma.InputJsonValue | undefined,
          ...(legacyMirror
            ? { scope: legacyMirror.scope, scopeId: legacyMirror.scopeId }
            : {}),
          updatedById: input.actorUserId ?? null,
        },
      });
      if (input.teamIds !== undefined) {
        await tx.aiToolEntryTeam.deleteMany({ where: { entryId: input.id } });
        if (input.teamIds.length > 0) {
          await tx.aiToolEntryTeam.createMany({
            data: input.teamIds.map((teamId) => ({
              entryId: input.id,
              teamId,
            })),
          });
        }
      }
      return await tx.aiToolEntry.findUniqueOrThrow({
        where: { id: input.id },
        include: { teams: { select: { teamId: true } } },
      });
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
   * admin-catalog.mdx). Three-way idempotent merge:
   *
   *   - existing org-scoped row matches by (type, displayName) AND has
   *     `iconAsset = null` → UPDATE that row's iconAsset in place
   *     (closes the bug where admin-created "Claude Code" — slug
   *     `claude-code-x7k2y9` from generateSlug — coexisted with a
   *     starter row at slug `claude-code` and the older NULL-icon
   *     row won the (order, displayName) sort)
   *   - existing match with `iconAsset` already populated → SKIP
   *     (admin curated the artwork; do not overwrite)
   *   - no existing match → CREATE
   *
   * Match is case-insensitive on displayName + scoped to org-wide rows
   * (scope='organization', scopeId=organizationId). Team-scoped tiles
   * are intentionally untouched: they're admin-curated overrides.
   *
   * Returns `{ created, updated, skipped }` so the UI can report
   * "imported N tiles, fixed M existing icons" instead of just an
   * insert count.
   */
  async seedStarterPack(input: {
    organizationId: string;
    actorUserId?: string | null;
    /**
     * When set, only these starter slugs are published; unknown slugs are
     * ignored. Omitted = the full pack (keeps the idempotent re-run path
     * and any existing caller working unchanged).
     */
    slugs?: string[];
  }): Promise<{ created: number; updated: number; skipped: number }> {
    const selectedTiles =
      input.slugs === undefined
        ? STARTER_PACK_TILES
        : STARTER_PACK_TILES.filter((t) => input.slugs!.includes(t.slug));
    const existing = await this.prisma.aiToolEntry.findMany({
      where: {
        organizationId: input.organizationId,
        scope: "organization",
        scopeId: input.organizationId,
      },
      select: { id: true, type: true, displayName: true, iconAsset: true },
    });

    type ExistingRow = (typeof existing)[number];
    const fingerprint = (type: string, displayName: string) =>
      `${type}::${displayName.trim().toLowerCase()}`;
    const byFingerprint = new Map<string, ExistingRow>();
    for (const row of existing) {
      byFingerprint.set(fingerprint(row.type, row.displayName), row);
    }

    type StarterTile = (typeof STARTER_PACK_TILES)[number];
    const toCreate: StarterTile[] = [];
    const toUpdate: { id: string; iconAsset: string }[] = [];
    let skipped = 0;

    for (const tile of selectedTiles) {
      const match = byFingerprint.get(fingerprint(tile.type, tile.displayName));
      if (!match) {
        toCreate.push(tile);
        continue;
      }
      if (match.iconAsset === null) {
        toUpdate.push({ id: match.id, iconAsset: tile.iconAsset });
        continue;
      }
      skipped += 1;
    }

    if (toCreate.length === 0 && toUpdate.length === 0) {
      return { created: 0, updated: 0, skipped };
    }

    await this.prisma.$transaction([
      ...toUpdate.map((u) =>
        this.prisma.aiToolEntry.update({
          where: { id: u.id },
          data: {
            iconAsset: u.iconAsset,
            updatedById: input.actorUserId ?? null,
          },
        }),
      ),
      ...toCreate.map((tile, index) =>
        this.prisma.aiToolEntry.create({
          data: {
            organizationId: input.organizationId,
            scope: "organization",
            scopeId: input.organizationId,
            type: tile.type,
            displayName: tile.displayName,
            slug: tile.slug,
            iconAsset: tile.iconAsset,
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
    ]);

    return {
      created: toCreate.length,
      updated: toUpdate.length,
      skipped,
    };
  }

  /**
   * Returns the distinct set of `provider` strings the org has at
   * least one *bindable* credential for — i.e. a live
   * `GatewayProviderCredential` (`disabledAt: null`) on a project in
   * the org whose parent `ModelProvider` is enabled. Drives the
   * per-tile "Provider not configured" preflight on /me — without
   * this, clicking an OpenAI tile in an Anthropic-only org silently
   * mints a VK that 502s on first curl with `provider_error` (Sergey
   * 3bbd7fbfc dogfood).
   *
   * Why this exact predicate: it mirrors the materialiser's
   * fail-closed binding contract (a5601f80a). If a credential
   * matching this shape exists anywhere in the org, the personal-VK
   * routing policy can route through it — guaranteeing the tile's
   * green state matches what the gateway will actually accept at
   * request time. Using the bare ModelProvider table (without the
   * `disabledAt: null` join) would over-report for orgs that have
   * an enabled MP but soft-disabled all of its bindings.
   *
   * Both `Project` and `ModelProvider` are exempt from
   * `dbMultiTenancyProtection`. `GatewayProviderCredential` is NOT
   * exempt but the `projectId: { in: ... }` shape satisfies the
   * guard's `projectId.in` allowance (line 233 of that middleware).
   */
  async listConfiguredProvidersForUser({
    organizationId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<string[]> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    const teamIds = teams.map((t) => t.id);
    const projectIds = teams.flatMap((t) => t.projects.map((p) => p.id));

    const rows = await this.prisma.modelProvider.findMany({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: {
          some: {
            OR: [
              { scopeType: "ORGANIZATION", scopeId: organizationId },
              ...(teamIds.length > 0
                ? [{ scopeType: "TEAM" as const, scopeId: { in: teamIds } }]
                : []),
              ...(projectIds.length > 0
                ? [{ scopeType: "PROJECT" as const, scopeId: { in: projectIds } }]
                : []),
            ],
          },
        },
      },
      select: { provider: true },
    });

    return Array.from(new Set(rows.map((r) => r.provider).filter(Boolean)));
  }

  /**
   * Admin-side dropdown source for the model_provider tile drawer.
   * Returns EVERY supported LLM provider the platform knows about
   * (sourced from `modelProviders` registry), each marked with a
   * `configured` flag based on whether the org has a bindable live
   * GatewayProviderCredential for that provider. The drawer surfaces
   * `configured: false` rows as a "Configure provider →" hint pointing
   * at /settings/model-providers — without that contract the warning
   * path is unreachable on a fresh org (caught in B1.1 G1: dev
   * fixture only had Anthropic configured, list collapsed to one row,
   * unconfigured-warning UX could never fire).
   *
   * The `configured` predicate matches the gateway's fail-closed
   * binding contract (`disabledAt: null` + parent ModelProvider
   * `enabled: true`) so a green flag in the drawer means the gateway
   * will actually accept a personal-VK request through that provider.
   */
  async listProviderOptionsForAdmin({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<
    Array<{ providerKey: string; displayName: string; configured: boolean }>
  > {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    const teamIds = teams.map((t) => t.id);
    const projectIds = teams.flatMap((t) => t.projects.map((p) => p.id));

    const configured = new Set(
      (
        await this.prisma.modelProvider.findMany({
          where: {
            enabled: true,
            disabledAt: null,
            scopes: {
              some: {
                OR: [
                  { scopeType: "ORGANIZATION", scopeId: organizationId },
                  ...(teamIds.length > 0
                    ? [{ scopeType: "TEAM" as const, scopeId: { in: teamIds } }]
                    : []),
                  ...(projectIds.length > 0
                    ? [
                        {
                          scopeType: "PROJECT" as const,
                          scopeId: { in: projectIds },
                        },
                      ]
                    : []),
                ],
              },
            },
          },
          select: { provider: true },
        })
      )
        .map((m) => m.provider)
        .filter(Boolean),
    );

    return Object.entries(supportedModelProviders)
      .filter(([, def]) => def.type === "llm")
      .map(([providerKey, def]) => ({
        providerKey,
        displayName: def.name ?? providerDisplayName(providerKey),
        configured: configured.has(providerKey),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Admin-side dropdown source for the model_provider tile's
   * `suggestedRoutingPolicyId`. Returns the org-scoped routing
   * policies (only — team-scoped policies are bound to a team's
   * personal-VK flow and not surfaceable through a tile config).
   */
  async listRoutingPolicyOptionsForAdmin({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    const policies = await this.prisma.routingPolicy.findMany({
      where: {
        organizationId,
        scopes: {
          some: { scopeType: "ORGANIZATION", scopeId: organizationId },
        },
      },
      select: { id: true, name: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return policies;
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
