// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * AiToolEntryService - owns the AI Tools Portal catalog (Phase 7).
 *
 * The portal lives at /me as a card grid (3 sections - coding
 * assistants, model providers, external tools) and is managed by org
 * admins at /settings/governance/tool-catalog.
 *
 * Scoping (read resolution):
 *   - org-scoped entries ("scope":"organization") are visible to ALL
 *     members of the org by default.
 *   - department-scoped entries ("scope":"department") are visible only
 *     to members whose OrganizationUser.departmentId is in the entry's
 *     department set (AiToolEntryDepartment join rows).
 *
 * The legacy team scope ("scope":"team" + AiToolEntryTeam) is retired:
 * existing team-scoped rows degrade to org-wide at read time (departments
 * are a new axis with no team->department mapping). New writes only ever
 * produce "organization" or "department".
 *
 * Per-type config schema (validated at create / update via zod
 * discriminated union - DB-level shape is `Json @default("{}")`):
 *
 *   coding_assistant: { setupCommand, setupDocsUrl, helperText? }
 *   model_provider:   { providerKey, suggestedRoutingPolicyId?,
 *                       defaultLabel?, projectSuggestionText? }
 *   external_tool:    { descriptionMarkdown, linkUrl, ctaLabel? }
 *
 * Authorisation: callers MUST gate on `aiTools:view` (read paths) or
 * `aiTools:manage` (write paths) BEFORE invoking these methods. The
 * service itself never checks RBAC - that's the router / route layer.
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

/// "organization" = org-wide. "department" = visible to members of the
/// bound departments. "team" remains only as a legacy read value for
/// pre-migration rows; the service never writes it.
export const SUPPORTED_SCOPES = ["organization", "department"] as const;
export type AiToolScope = (typeof SUPPORTED_SCOPES)[number] | "team";

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

/**
 * Maps a coding-assistant tile's `assistantKind` to the CLI tool slug the
 * `langwatch <tool>` wrapper uses (and the slug PlatformToolPolicy keyed on).
 * Only the five wrapped tools map; kinds with no CLI wrapper (github_copilot,
 * custom) are absent and contribute no toolPolicies entry. cliBootstrap reads
 * this to derive the login `toolPolicies` map from tile config.
 */
export const ASSISTANT_KIND_TO_TOOL_SLUG: Partial<
  Record<AssistantKind, "claude" | "codex" | "gemini" | "opencode" | "cursor">
> = {
  claude_code: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  cursor: "cursor",
};

const codingAssistantConfig = z.object({
  /// Discriminator inside config so the drawer can render the matching
  /// preset icon + setup hints. Required for new writes; existing rows
  /// without it default to "custom" at read time.
  assistantKind: z.enum(SUPPORTED_ASSISTANT_KINDS).optional(),
  setupCommand: z.string().min(1).max(256),
  // Drawer labels "Setup docs URL (optional)" and only includes the
  // field in the wire payload when filled. Schema must match - when
  // required, every catalog publish 400'd with `Required` (Ariana QA
  // admin-hat #2). Type label says optional, behavior should too.
  setupDocsUrl: z.string().url().max(2048).optional(),
  helperText: z.string().max(2048).optional(),
  /// CLI path policy folded into the tile (replaces PlatformToolPolicy).
  /// Both default to true when absent - see cliBootstrap.service.ts, which
  /// reads these to derive the login `toolPolicies` map. The "cursor"
  /// assistant is forced to allowOtelDirect=false at the resolution layer
  /// (GUI-only), so a stored true there is still treated as false.
  allowVk: z.boolean().optional(),
  allowOtelDirect: z.boolean().optional(),
  /// Whether usage that lands via the direct OTLP ingestion path is part of
  /// a bundled subscription plan (e.g. Claude Max) rather than billed per
  /// token. Defaults to true when absent: coding assistants are usually on a
  /// flat plan, so their list-price token cost is "theoretical" (non-billed)
  /// rather than real spend. Gateway / virtual-key usage is ALWAYS billed and
  /// ignores this flag (we route it through a key the user pays per token).
  /// The receiver stamps the resolved value onto ingest traces
  /// (`langwatch.cost.non_billable`) so the trace summary can split billed vs
  /// non-billed cost.
  bundledPlan: z.boolean().optional(),
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
  /// @deprecated Use `departmentIds` instead. Populated for back-compat
  /// reads; mirrors `departmentIds` at write time (`organization` when
  /// empty, `department` when 1+).
  scope: AiToolScope;
  /// @deprecated Use `departmentIds` instead. Mirrors the org/first-dept
  /// id for back-compat - see `scope` above.
  scopeId: string;
  /// Department scope. Empty array = org-wide. Non-empty = visible only
  /// to members whose departmentId is in this set.
  departmentIds: string[];
  type: AiToolType;
  displayName: string;
  slug: string;
  /// @deprecated Use `iconAsset` - kept for back-compat with
  /// pre-refactor rows.
  iconKey: string | null;
  /// Prefix-discriminated icon source:
  ///   "preset:<kind>"        - built-in icon
  ///   "data:image/...;base64,..." - admin-uploaded
  ///   null                    - UI falls back to type default
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
  departments?: { departmentId: string }[];
}

function toDto(row: AiToolEntryRow): AiToolEntryDto {
  // New shape: AiToolEntryDepartment[] is the source of truth. Back-compat:
  // a pre-migration row with scope='department' but no join rows mirrors its
  // scopeId. Legacy team-scoped rows degrade to org-wide (empty set).
  const departmentIds =
    row.departments?.map((d) => d.departmentId) ??
    (row.scope === "department" && row.scopeId ? [row.scopeId] : []);
  return {
    ...row,
    scope: row.scope as AiToolScope,
    type: row.type as AiToolType,
    departmentIds,
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
 * Pretty label for the admin drawer's provider dropdown. Falls back
 * to a Title-Cased rendering of the provider key when not explicitly
 * mapped - covers custom / future providers without a code change.
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

/**
 * Mirror the `departmentIds[]` shape onto the legacy `scope`/`scopeId`
 * pair so any reader still hitting those columns sees a coherent row.
 *   []           → scope='organization', scopeId=organizationId
 *   [d, ...]     → scope='department',   scopeId=departments[0]   (best
 *                  effort - multi-department can't be represented in the
 *                  legacy pair; readers should prefer departments[]).
 * Drops out of the service public API once scope/scopeId are removed in a
 * follow-up migration.
 */
function legacyScopeFromDepartmentIds({
  organizationId,
  departmentIds,
}: {
  organizationId: string;
  departmentIds: string[];
}): { scope: AiToolScope; scopeId: string } {
  if (departmentIds.length === 0) {
    return { scope: "organization", scopeId: organizationId };
  }
  return { scope: "department", scopeId: departmentIds[0]! };
}

/**
 * The starter pack documented in docs/ai-governance/personal-portal/
 * admin-catalog.mdx §"Starter pack" - a sensible default set that gives
 * a fresh org an immediately useful /me portal grid. Coding assistants
 * point at the `langwatch <tool>` device-flow command; model providers
 * carry a `providerKey` slug so the user-side click-to-expand can mint
 * a personal VK against the right backend without further admin input.
 *
 * External tools deliberately omitted - admins fill those in per-org
 * with internal links (no useful default exists across orgs).
 *
 * Cursor is intentionally omitted until `langwatch cursor` is validated
 * end to end (https://github.com/langwatch/langwatch/issues/4647): the
 * wrapper command exists but its telemetry/governance path is unverified,
 * so we do not seed a tile we cannot stand behind.
 */
export const STARTER_PACK_TILES: ReadonlyArray<{
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
    type: "coding_assistant",
    slug: "opencode",
    displayName: "opencode",
    iconAsset: "preset:opencode",
    config: {
      assistantKind: "opencode",
      setupCommand: "langwatch opencode",
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
      // (^[a-z0-9][a-z0-9_\-]*$) - Ariana caught the original
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
   * Per-tool CLI path overrides derived from the coding_assistant tiles
   * the calling user can actually see. For each visible tile whose
   * `assistantKind` maps to a CLI slug ({@link ASSISTANT_KIND_TO_TOOL_SLUG}),
   * reads `config.allowVk` / `config.allowOtelDirect` (absent → true).
   * Cursor is forced to allowOtelDirect=false regardless of stored value
   * (GUI-only).
   *
   * Visibility + precedence go through {@link resolveVisibleTilesForUser},
   * so a department-scoped tile only governs the CLI paths of members who
   * can see it (and shadows the org-wide tile for them), keeping the cached
   * bootstrap map in lockstep with the tile the user gets in the portal. A
   * member outside that department falls through to the org-wide tile or
   * the hardcoded default.
   *
   * Returns ONLY slugs that have a visible tile (a partial map).
   * cliBootstrap merges this over the hardcoded
   * {@link PLATFORM_TOOL_POLICY_DEFAULTS} so a slug with no tile keeps its
   * default - this is the replacement for the retired PlatformToolPolicy
   * table. Disabled / archived tiles are ignored (an admin who hides a
   * tile also stops governing its paths; the hardcoded default takes over).
   *
   * When two visible tiles map to the same CLI slug, the lowest-`order`
   * one wins (the same precedence the portal grid renders), keeping the
   * result deterministic.
   */
  async resolveToolPolicyOverrides({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<
    Partial<
      Record<
        "claude" | "codex" | "gemini" | "opencode" | "cursor",
        { allowVk: boolean; allowOtelDirect: boolean }
      >
    >
  > {
    const tiles = await this.resolveVisibleTilesForUser({
      organizationId,
      userId,
      type: "coding_assistant",
    });
    // The shadow already resolved department-vs-org per tile `slug`;
    // re-sort so two distinct tile slugs that map to the same CLI slug
    // still resolve deterministically by (order, displayName).
    const sorted = [...tiles].sort(
      (a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName),
    );

    const overrides: Partial<
      Record<
        "claude" | "codex" | "gemini" | "opencode" | "cursor",
        { allowVk: boolean; allowOtelDirect: boolean }
      >
    > = {};

    for (const tile of sorted) {
      const config = (tile.config as Record<string, unknown>) ?? {};
      const kind = config.assistantKind;
      if (typeof kind !== "string") continue;
      const slug = ASSISTANT_KIND_TO_TOOL_SLUG[kind as AssistantKind];
      if (!slug) continue;
      // First (lowest-order) tile per slug wins.
      if (overrides[slug]) continue;

      const allowVk = config.allowVk === undefined ? true : !!config.allowVk;
      const allowOtelDirect =
        slug === "cursor"
          ? false
          : config.allowOtelDirect === undefined
            ? true
            : !!config.allowOtelDirect;
      overrides[slug] = { allowVk, allowOtelDirect };
    }

    return overrides;
  }

  /**
   * The CLI login-ceremony projection: the coding assistants the member can
   * run via `langwatch <slug>` and the model providers they can mint a
   * personal virtual key for. Both come from the same visible catalog tiles
   * the /me portal renders ({@link resolveVisibleTilesForUser}), so the CLI
   * summary stays in lockstep with the portal instead of leaking env-fed
   * project providers the org never published to the catalog.
   *
   * `tools` carries only assistant kinds that have a `langwatch <slug>`
   * wrapper ({@link ASSISTANT_KIND_TO_TOOL_SLUG}); `providers` carries every
   * model_provider tile's `providerKey`, each flagged with whether the org
   * actually has a live credential for it ({@link
   * listConfiguredProvidersForUser}). Both lists dedupe on their key, keeping
   * the lowest-`order` tile (the same precedence the portal grid renders).
   */
  async resolveCliCatalogForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<{
    tools: Array<{ slug: string; displayName: string }>;
    providers: Array<{
      providerKey: string;
      displayName: string;
      configured: boolean;
    }>;
  }> {
    const [assistantTiles, providerTiles, configuredProviders] =
      await Promise.all([
        this.resolveVisibleTilesForUser({
          organizationId,
          userId,
          type: "coding_assistant",
        }),
        this.resolveVisibleTilesForUser({
          organizationId,
          userId,
          type: "model_provider",
        }),
        this.listConfiguredProvidersForUser({ organizationId, userId }),
      ]);
    const configuredSet = new Set(configuredProviders);

    const byOrder = <T extends { order: number; displayName: string }>(
      a: T,
      b: T,
    ) => a.order - b.order || a.displayName.localeCompare(b.displayName);

    const tools: Array<{ slug: string; displayName: string }> = [];
    const seenSlugs = new Set<string>();
    for (const tile of [...assistantTiles].sort(byOrder)) {
      const config = (tile.config as Record<string, unknown>) ?? {};
      const kind = config.assistantKind;
      if (typeof kind !== "string") continue;
      const slug = ASSISTANT_KIND_TO_TOOL_SLUG[kind as AssistantKind];
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      tools.push({ slug, displayName: tile.displayName });
    }

    const providers: Array<{
      providerKey: string;
      displayName: string;
      configured: boolean;
    }> = [];
    const seenProviders = new Set<string>();
    for (const tile of [...providerTiles].sort(byOrder)) {
      const config = (tile.config as Record<string, unknown>) ?? {};
      const providerKey = config.providerKey;
      if (typeof providerKey !== "string" || seenProviders.has(providerKey)) {
        continue;
      }
      seenProviders.add(providerKey);
      providers.push({
        providerKey,
        displayName: tile.displayName,
        configured: configuredSet.has(providerKey),
      });
    }

    return { tools, providers };
  }

  /**
   * Resolve the catalog tiles visible to one member, with the
   * department-overrides-org shadow already applied. Shared by the
   * user-facing list ({@link listForUser}) and the CLI path-policy
   * resolver ({@link resolveToolPolicyOverrides}) so both surfaces honour
   * the exact same visibility + precedence: a member only ever sees (and
   * is governed by) the tile the portal would render for them.
   *
   *   - Org-wide entries (scope='organization', legacy 'team', or an empty
   *     department set) are visible to all members.
   *   - Department-scoped entries are visible only when the member's
   *     OrganizationUser.departmentId is in the entry's department set
   *     (AiToolEntryDepartment is the source of truth; an empty set with
   *     scope='department' falls back to the legacy scopeId).
   *   - A department-bound entry SHADOWS an org-wide entry with the same
   *     `slug` for members of that department.
   *
   * Optionally narrowed to one tile `type`. Rows are pulled sorted by
   * (order ASC, displayName ASC); the shadow keeps each slug's first
   * (lowest-order) appearance unless a department-bound row supersedes it.
   */
  private async resolveVisibleTilesForUser({
    organizationId,
    userId,
    type,
  }: {
    organizationId: string;
    userId: string;
    type?: AiToolType;
  }): Promise<
    Prisma.AiToolEntryGetPayload<{
      include: { departments: { select: { departmentId: true } } };
    }>[]
  > {
    // Resolve the member's department in this org so we can filter
    // department-scoped entries. One nullable departmentId per
    // OrganizationUser (the people lens).
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { departmentId: true },
    });
    const userDepartmentId = membership?.departmentId ?? null;

    // Pull every active row in the org with its department bindings
    // pre-joined; we filter visibility in JS so the department-overrides-
    // org shadow is straightforward to express. Cardinality is per-org-
    // catalog (~dozens), so the simpler shape outweighs a smarter SQL
    // filter here.
    const rows = await this.prisma.aiToolEntry.findMany({
      where: {
        organizationId,
        enabled: true,
        archivedAt: null,
        ...(type ? { type } : {}),
      },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
      include: { departments: { select: { departmentId: true } } },
    });

    const visible = rows.filter((row) => {
      // New shape: AiToolEntryDepartment[] is the source of truth. A
      // member with no department never matches a department-bound tile.
      if (row.departments.length > 0) {
        return (
          userDepartmentId !== null &&
          row.departments.some((d) => d.departmentId === userDepartmentId)
        );
      }
      // Empty department set + scope='department' (a hand-edited /
      // pre-migration row) → fall back to the legacy scopeId check.
      if (row.scope === "department") {
        return userDepartmentId !== null && row.scopeId === userDepartmentId;
      }
      // scope='organization', legacy 'team', or missing → org-wide.
      // Legacy team rows intentionally degrade to org-wide here.
      return true;
    });

    // Apply department-overrides-org by slug. A department-bound entry
    // shadows an org-wide entry with the same slug for members of that
    // department.
    const bySlug = new Map<string, (typeof visible)[number]>();
    for (const row of visible) {
      const existing = bySlug.get(row.slug);
      if (!existing) {
        bySlug.set(row.slug, row);
        continue;
      }
      const rowIsDeptBound =
        row.departments.length > 0 || row.scope === "department";
      const existingIsDeptBound =
        existing.departments.length > 0 || existing.scope === "department";
      if (rowIsDeptBound && !existingIsDeptBound) {
        bySlug.set(row.slug, row);
      }
    }

    return Array.from(bySlug.values());
  }

  /**
   * User-facing list. Returns enabled, non-archived entries visible to
   * the calling user with the department-overrides-org shadow applied
   * (see {@link resolveVisibleTilesForUser}). Sorted by (order ASC,
   * displayName ASC).
   */
  async listForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AiToolEntryDto[]> {
    const tiles = await this.resolveVisibleTilesForUser({
      organizationId,
      userId,
    });
    return tiles.map(toDto);
  }

  /**
   * Admin list. Returns every live entry (incl. disabled) for the catalog
   * editor surface. Deleted tiles are removed for good, so there is no
   * archived tail to surface here.
   */
  async listForAdmin({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AiToolEntryDto[]> {
    const rows = await this.prisma.aiToolEntry.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ order: "asc" }, { displayName: "asc" }],
      include: { departments: { select: { departmentId: true } } },
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
      include: { departments: { select: { departmentId: true } } },
    });
    if (!row || row.organizationId !== organizationId) return null;
    return toDto(row);
  }

  async create(input: {
    organizationId: string;
    /// Empty array = org-wide (visible to every member). Non-empty
    /// = entry visible only to members of those departments.
    departmentIds: string[];
    type: AiToolType;
    displayName: string;
    /// Optional iconAsset - "preset:<kind>" for built-in icons or
    /// a base64 data URL for admin-uploaded SVG/PNG. UI falls back
    /// to a type-default when null.
    iconAsset?: string | null;
    order?: number;
    config: Record<string, unknown>;
    actorUserId?: string | null;
  }): Promise<AiToolEntryDto> {
    AiToolConfigSchema.parse({ type: input.type, config: input.config });

    // Validate referenced departments belong to the calling org. Without
    // this an admin could bind a tile to a department in a foreign org and
    // cause cross-org visibility leaks.
    if (input.departmentIds.length > 0) {
      await this.assertDepartmentsInOrg({
        organizationId: input.organizationId,
        departmentIds: input.departmentIds,
      });
    }

    // Back-compat mirror to scope/scopeId so any reader still hitting
    // the legacy columns sees a coherent row. A follow-up migration
    // drops both once every reader prefers the join table.
    const { scope, scopeId } = legacyScopeFromDepartmentIds({
      organizationId: input.organizationId,
      departmentIds: input.departmentIds,
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
      if (input.departmentIds.length > 0) {
        await tx.aiToolEntryDepartment.createMany({
          data: input.departmentIds.map((departmentId) => ({
            entryId: created.id,
            departmentId,
          })),
        });
      }
      return await tx.aiToolEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: { departments: { select: { departmentId: true } } },
      });
    });
    return toDto(row);
  }

  async update(input: {
    id: string;
    organizationId: string;
    displayName?: string;
    iconAsset?: string | null;
    /// Pass to overwrite the department binding set. Empty = org-wide.
    /// Omit to leave the existing binding untouched.
    departmentIds?: string[];
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

    if (input.departmentIds && input.departmentIds.length > 0) {
      await this.assertDepartmentsInOrg({
        organizationId: input.organizationId,
        departmentIds: input.departmentIds,
      });
    }

    const legacyMirror =
      input.departmentIds !== undefined
        ? legacyScopeFromDepartmentIds({
            organizationId: input.organizationId,
            departmentIds: input.departmentIds,
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
      if (input.departmentIds !== undefined) {
        await tx.aiToolEntryDepartment.deleteMany({
          where: { entryId: input.id },
        });
        if (input.departmentIds.length > 0) {
          await tx.aiToolEntryDepartment.createMany({
            data: input.departmentIds.map((departmentId) => ({
              entryId: input.id,
              departmentId,
            })),
          });
        }
      }
      return await tx.aiToolEntry.findUniqueOrThrow({
        where: { id: input.id },
        include: { departments: { select: { departmentId: true } } },
      });
    });
    return toDto(row);
  }

  /**
   * Guard: every id must be an active department in the calling org.
   * Archived or foreign-org departments throw - without this an admin
   * could bind a tile to a department in another org and leak visibility.
   */
  private async assertDepartmentsInOrg({
    organizationId,
    departmentIds,
  }: {
    organizationId: string;
    departmentIds: string[];
  }): Promise<void> {
    const valid = await this.prisma.department.count({
      where: {
        id: { in: departmentIds },
        organizationId,
        archivedAt: null,
      },
    });
    if (valid !== new Set(departmentIds).size) {
      throw new Error(
        "One or more departments do not belong to this organization",
      );
    }
  }

  /**
   * Permanently remove a tile from the catalog. Deleting (as opposed to
   * disabling) drops the row outright, so it vanishes from both the admin
   * editor and every member's /me portal. The department / team scope
   * bindings are removed via `onDelete: Cascade`; nothing else
   * foreign-keys the tile (virtual keys and ingest keys carry their own
   * resolved values, not a tile reference), so there are no orphans.
   *
   * Reversible hiding is a separate action — `setEnabled(false)` keeps the
   * row and its config so an admin can re-enable it later.
   */
  async remove({
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
    const row = await this.prisma.aiToolEntry.delete({
      where: { id },
      include: { departments: { select: { departmentId: true } } },
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
   *     (closes the bug where admin-created "Claude Code" - slug
   *     `claude-code-x7k2y9` from generateSlug - coexisted with a
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
            // Append after any tiles the admin already created - keeps
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
   * Returns the distinct set of `provider` strings the caller can
   * reach a *bindable* credential for - an enabled `ModelProvider`
   * (`disabledAt: null`) scoped either org-wide or to a team/project
   * the caller belongs to. Drives the per-tile "Provider not
   * configured" preflight on /me - without this, clicking an OpenAI
   * tile in an Anthropic-only org silently mints a VK that 502s on
   * first curl with `provider_error` (Sergey 3bbd7fbfc dogfood).
   *
   * Scoping to the caller's memberships is load-bearing: a provider
   * configured only on a team the caller is not a member of is not
   * reachable by their personal VK, so reporting it as configured
   * would green-light a tile that mints a VK which can't route.
   *
   * Why this exact predicate: it mirrors the materialiser's
   * fail-closed binding contract (a5601f80a). If a credential
   * matching this shape is reachable by the caller, the personal-VK
   * routing policy can route through it - guaranteeing the tile's
   * green state matches what the gateway will actually accept at
   * request time. Using the bare ModelProvider table (without the
   * `disabledAt: null` join) would over-report for orgs that have
   * an enabled MP but soft-disabled all of its bindings.
   */
  async listConfiguredProvidersForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<string[]> {
    // Only teams the caller actually belongs to. A TEAM/PROJECT-scoped
    // provider on a team the caller can't reach must not green-light the
    // tile - ORGANIZATION-scoped credentials still count for every member.
    const memberships = await this.prisma.teamUser.findMany({
      where: { userId, team: { organizationId } },
      select: { teamId: true, team: { select: { projects: { select: { id: true } } } } },
    });
    const teamIds = memberships.map((m) => m.teamId);
    const projectIds = memberships.flatMap((m) =>
      m.team.projects.map((p) => p.id),
    );

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
   * at /settings/model-providers - without that contract the warning
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
   * policies (only - team-scoped policies are bound to a team's
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
