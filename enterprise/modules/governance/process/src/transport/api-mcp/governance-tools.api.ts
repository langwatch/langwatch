// MCP governance toolset: mirrors Hono API shape, dispatches in-process through
// shared services. RBAC at tool layer; OAuth for writes, project-apiKey for reads.

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type ZodRawShape, z } from "zod";

type ToolResult = Promise<{ content: { type: "text"; text: string }[] }>;

/**
 * Structural shape we use from the McpServer instance returned by
 * `@langwatch/mcp-server.createMcpServer`, mirroring that package's narrow
 * `.d.ts` so callers can pass the same value verbatim without an `as` cast.
 */
type McpServerLike = {
  tool<Shape extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    cb: (args: z.infer<z.ZodObject<Shape>>) => ToolResult,
  ): unknown;
};

/**
 * Whether the caller holds a permission on an organization. Injected rather
 * than imported: the decision belongs to the process's own AuthZ graph, not
 * a global one the request path beside it doesn't share.
 */
export abstract class GovernanceMcpPermissionProbe {
  abstract holdsOrganizationPermission(input: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<boolean>;
}

const SURFACE = "mcp" as const;

const FORBIDDEN_PREFIX = "FORBIDDEN: ";
const NEEDS_OAUTH_PREFIX = "AUTH_REQUIRED: ";

export interface GovernanceMcpContext {
  projects: Pick<ProjectApi, "findIdByLegacyApiKey" | "getOrganizationId">;
  governance: GovernanceApi;
  /** The organization permission decision this surface is judged by. */
  permissions: GovernanceMcpPermissionProbe;
  /** Project apiKey from the MCP session (used to derive organizationId). */
  apiKey: string;
  /**
   * OAuth-flowing user id captured at /api/mcp/authorize, propagated via
   * the OAuth token cache. Absent for project-apiKey-only sessions —
   * write tools reject those with NEEDS_OAUTH_PREFIX.
   */
  callerUserId?: string;
}

interface ResolvedContext {
  organizationId: string;
  callerUserId?: string;
}

/**
 * Registers the 11 governance MCP tools on the given session-scoped
 * McpServer. Resolves the caller's organization from the apiKey lazily on
 * the first tool invocation and caches per-session.
 */
export function registerGovernanceMcpTools(server: McpServerLike, ctx: GovernanceMcpContext): void {
  let resolvedPromise: Promise<ResolvedContext> | null = null;
  const resolve = async (): Promise<ResolvedContext> => {
    if (!resolvedPromise) {
      resolvedPromise = (async () => {
        const projectId = await ctx.projects.findIdByLegacyApiKey({ token: ctx.apiKey });
        if (projectId === null) {
          throw new Error(
            "MCP session apiKey did not resolve to a project — cannot derive organization context for governance tools.",
          );
        }
        const organizationId = await ctx.projects.getOrganizationId(projectId);
        return { organizationId, callerUserId: ctx.callerUserId };
      })();
    }
    return resolvedPromise;
  };

  const requirePermission = async (
    rctx: ResolvedContext,
    permission: AuthzPermission,
  ): Promise<string | null> => {
    if (!rctx.callerUserId) {
      return `${NEEDS_OAUTH_PREFIX}This governance MCP tool requires an OAuth-authenticated session (mint via /api/mcp/authorize). Project-apiKey-only sessions can use read tools but cannot perform writes.`;
    }
    const allowed = await ctx.permissions.holdsOrganizationPermission({
      userId: rctx.callerUserId,
      organizationId: rctx.organizationId,
      permission,
    });
    if (!allowed) {
      return `${FORBIDDEN_PREFIX}caller lacks permission '${permission}' on organization ${rctx.organizationId}`;
    }
    return null;
  };

  const requireRead = async (
    rctx: ResolvedContext,
    permission: AuthzPermission,
  ): Promise<string | null> => {
    // Read tools may run without callerUserId (project-apiKey sessions),
    // since the legacy MCP auth path is project-scoped and the org is
    // implicit. Only enforce permission when a userId is present.
    if (!rctx.callerUserId) return null;
    const allowed = await ctx.permissions.holdsOrganizationPermission({
      userId: rctx.callerUserId,
      organizationId: rctx.organizationId,
      permission,
    });
    if (!allowed) {
      return `${FORBIDDEN_PREFIX}caller lacks permission '${permission}' on organization ${rctx.organizationId}`;
    }
    return null;
  };

  const text = (value: string) => ({
    content: [{ type: "text" as const, text: value }],
  });
  const json = (value: unknown) => text(JSON.stringify(value, null, 2));

  // ── IngestionTemplate ────────────────────────────────────────────────

  server.tool(
    "governance_ingestion_templates_list",
    "List the user-visible ingestion templates for the caller's organization. Returns the union of platform-published defaults and any org-authored rows; excludes the OTTL source. Mirrors GET /api/governance/ingestion-templates.",
    {},
    async () => {
      const r = await resolve();
      const denied = await requireRead(r, "aiTools:view");
      if (denied) return text(denied);
      const rows = await ctx.governance.templateListForUser({
        organizationId: r.organizationId,
      });
      return json(rows);
    },
  );

  server.tool(
    "governance_ingestion_templates_admin_list",
    "Admin catalog read — same union as the user-visible list but INCLUDES ottlRules. Requires aiTools:manage. Mirrors GET /api/governance/ingestion-templates/admin.",
    {},
    async () => {
      const r = await resolve();
      // Admin catalog returns OTTL source (org config secret) and gates
      // on aiTools:manage — treat it like a write: project-apiKey-only
      // sessions without a user identity are rejected, not silently allowed.
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      const rows = await ctx.governance.templateListForOrgAdmin({
        organizationId: r.organizationId,
      });
      return json(rows);
    },
  );

  server.tool(
    "governance_ingestion_templates_get",
    "Fetch a single ingestion template by id. Cross-org probes return null. Mirrors GET /api/governance/ingestion-templates/:id.",
    { id: z.string().describe("IngestionTemplate id") },
    async ({ id }) => {
      const r = await resolve();
      const denied = await requireRead(r, "aiTools:view");
      if (denied) return text(denied);
      const row = await ctx.governance.findTemplateByIdForOrg({
        id,
        organizationId: r.organizationId,
      });
      return json(row);
    },
  );

  server.tool(
    "governance_ingestion_templates_create",
    "Author a new org-scoped ingestion template. The slug is auto-generated from displayName + a random suffix. Requires aiTools:manage. Mirrors POST /api/governance/ingestion-templates.",
    {
      source_type: z
        .string()
        .describe(
          "Lowercase + underscores. Discriminator that matches an upstream emitter (e.g. 'codex_internal').",
        ),
      display_name: z.string(),
      description: z.string().optional(),
      icon_asset: z.string().optional(),
      credential_schema: z.string().optional(),
      ottl_rules: z.string().optional(),
    },
    async (input) => {
      const r = await resolve();
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      const row = await ctx.governance.templateCreateOrg({
        organizationId: r.organizationId,
        callerUserId: r.callerUserId!,
        sourceType: input.source_type,
        displayName: input.display_name,
        description: input.description ?? null,
        iconAsset: input.icon_asset ?? null,
        credentialSchema: input.credential_schema ?? null,
        ottlRules: input.ottl_rules ?? "",
        surface: SURFACE,
      });
      return json(row);
    },
  );

  server.tool(
    "governance_ingestion_templates_update_ottl_rules",
    "Update the ottlRules of an org-authored template. Platform rows are immutable. Requires aiTools:manage. Mirrors PATCH /api/governance/ingestion-templates/:id/ottl-rules.",
    {
      id: z.string(),
      ottl_rules: z.string().describe("New ottlRules body. Empty string permitted."),
    },
    async ({ id, ottl_rules }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      const row = await ctx.governance.templateUpdateOttlRules({
        id,
        organizationId: r.organizationId,
        callerUserId: r.callerUserId!,
        ottlRules: ottl_rules,
        surface: SURFACE,
      });
      return json(row);
    },
  );

  server.tool(
    "governance_ingestion_templates_clone_from_platform",
    "Clone a platform-published template into an editable org-authored row. Requires aiTools:manage. Mirrors POST /api/governance/ingestion-templates/:id/clone.",
    { source_template_id: z.string() },
    async ({ source_template_id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      const row = await ctx.governance.templateCloneFromPlatform({
        sourceTemplateId: source_template_id,
        organizationId: r.organizationId,
        callerUserId: r.callerUserId!,
        surface: SURFACE,
      });
      return json(row);
    },
  );

  server.tool(
    "governance_ingestion_templates_archive",
    "Soft-archive an org-authored template. Existing ingestion keys continue to land traces; new installs are blocked. Requires aiTools:manage. Mirrors DELETE /api/governance/ingestion-templates/:id.",
    { id: z.string() },
    async ({ id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      await ctx.governance.templateArchiveOrg({
        id,
        organizationId: r.organizationId,
        callerUserId: r.callerUserId!,
        surface: SURFACE,
      });
      return text(`archived ${id}`);
    },
  );

  // ── Ingestion keys ──────────────────────────────────────────────────

  server.tool(
    "governance_ingestion_keys_list",
    "List the caller's live ingestion keys (one per connected source) in their personal project. Requires OAuth-authenticated session + organization:view.",
    {},
    async () => {
      const r = await resolve();
      if (!r.callerUserId) {
        return text(
          `${NEEDS_OAUTH_PREFIX}listing your own ingestion keys requires an OAuth-authenticated MCP session.`,
        );
      }
      const denied = await requireRead(r, "organization:view");
      if (denied) return text(denied);
      const rows = await ctx.governance.ingestionKeyListForPersonalProject({
        userId: r.callerUserId,
        organizationId: r.organizationId,
      });
      return json(rows);
    },
  );

  server.tool(
    "governance_ingestion_keys_mint",
    "Mint an ingestion key for the caller's personal project + source_type, returning the ik-lw-* token (shown ONCE). Minting adds a key rather than replacing one, so the keys other machines already export with keep working; the only exception is the per-source cap, which retires the least recently used key once the workspace holds 32 of them. source_type must be a tool the LangWatch CLI wraps, or match a published ingestion template named by template_id. Requires OAuth-authenticated session + organization:view.",
    {
      source_type: z.string(),
      template_id: z.string().optional(),
    },
    async ({ source_type, template_id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "organization:view");
      if (denied) return text(denied);
      // Create-only: an agent asking for a key for the machine it runs on
      // must not revoke the key every other machine under this login is
      // exporting with. The explicit rotate lives on the /me tile. On this
      // branch the create-only shape is `issueForPersonalProject`; `ensure`
      // is the one that would reuse and rotate.
      const result = await ctx.governance.ingestionKeyIssueForPersonalProject({
        userId: r.callerUserId!,
        organizationId: r.organizationId,
        sourceType: source_type,
        ingestionTemplateId: template_id ?? null,
      });
      return json(result);
    },
  );
}
