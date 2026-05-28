/**
 * Governance MCP toolset — Ask B-MCP per umbrella spec
 * (specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature).
 *
 * Mirrors the Hono /api/governance/* resource×verb shape (sergey 0bb951160 +
 * 5275e7e11 + 8fffad4ad) but dispatches IN-PROCESS through the same shared
 * service-layer functions, passing `surface: 'mcp'` per the GovernanceCallSurface
 * contract (sergey fc6d54100). No HTTP round-trip, no auth-token mismatch with
 * the human-caller PAT path. Service-layer-shared invariant from umbrella spec
 * @service-layer is satisfied: tRPC + Hono + CLI + MCP all funnel through the
 * same IngestionTemplateService + UserIngestionBindingService.
 *
 * RBAC enforcement at the tool layer (per @governance-mcp @rbac): each tool
 * checks the caller's organization permissions BEFORE the service call and
 * returns FORBIDDEN otherwise. Mirrors `hasOrganizationPermission` from
 * src/server/api/rbac.ts. Services trust the surface for audit attribution
 * but DO NOT gate access — gating is the entrypoint's job.
 *
 * Caller identity: governance write tools require an OAuth-authenticated MCP
 * session (the userId is captured at /api/mcp/authorize and threaded through
 * to the SessionState here). Project-apiKey-only sessions get read tools but
 * are rejected on writes with a clear error message pointing them at the
 * OAuth flow.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 * Docs: docs/ai-governance/mcp.mdx
 */

import type { PrismaClient } from "@prisma/client";
import { z, type ZodRawShape } from "zod";

type ToolCallback = (
  // The MCP SDK passes parsed input as the first arg; we don't currently
  // need the second `extra` parameter.
  args: any,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

/**
 * Structural shape we use from the McpServer instance returned by
 * `@langwatch/mcp-server.createMcpServer`. The .d.ts in that package
 * intentionally narrows McpServer to keep the langwatch app's typecheck
 * cheap; we mirror that narrow shape here so callers can pass the same
 * value verbatim without an `as` cast.
 */
type McpServerLike = {
  tool(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    cb: ToolCallback,
  ): unknown;
};

import { IngestionTemplateService } from "../../ee/governance/services/ingestionTemplate.service";
import { UserIngestionBindingService } from "../../ee/governance/services/userIngestionBinding.service";
import {
  hasOrganizationPermission,
  type Permission,
} from "../server/api/rbac";

const SURFACE = "mcp" as const;

const FORBIDDEN_PREFIX = "FORBIDDEN: ";
const NEEDS_OAUTH_PREFIX = "AUTH_REQUIRED: ";

export interface GovernanceMcpContext {
  prisma: PrismaClient;
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
export function registerGovernanceMcpTools(
  server: McpServerLike,
  ctx: GovernanceMcpContext,
): void {
  let resolvedPromise: Promise<ResolvedContext> | null = null;
  const resolve = async (): Promise<ResolvedContext> => {
    if (!resolvedPromise) {
      resolvedPromise = (async () => {
        const project = await ctx.prisma.project.findUnique({
          where: { apiKey: ctx.apiKey, archivedAt: null },
          select: { team: { select: { organizationId: true } } },
        });
        if (!project) {
          throw new Error(
            "MCP session apiKey did not resolve to a project — cannot derive organization context for governance tools.",
          );
        }
        return {
          organizationId: project.team.organizationId,
          callerUserId: ctx.callerUserId,
        };
      })();
    }
    return resolvedPromise;
  };

  const requirePermission = async (
    rctx: ResolvedContext,
    permission: Permission,
  ): Promise<string | null> => {
    if (!rctx.callerUserId) {
      return `${NEEDS_OAUTH_PREFIX}This governance MCP tool requires an OAuth-authenticated session (mint via /api/mcp/authorize). Project-apiKey-only sessions can use read tools but cannot perform writes.`;
    }
    const allowed = await hasOrganizationPermission(
      { prisma: ctx.prisma, session: { user: { id: rctx.callerUserId } } as any },
      rctx.organizationId,
      permission,
    );
    if (!allowed) {
      return `${FORBIDDEN_PREFIX}caller lacks permission '${permission}' on organization ${rctx.organizationId}`;
    }
    return null;
  };

  const requireRead = async (
    rctx: ResolvedContext,
    permission: Permission,
  ): Promise<string | null> => {
    // Read tools may run without callerUserId (project-apiKey sessions),
    // since the legacy MCP auth path is project-scoped and the org is
    // implicit. Only enforce permission when a userId is present.
    if (!rctx.callerUserId) return null;
    const allowed = await hasOrganizationPermission(
      { prisma: ctx.prisma, session: { user: { id: rctx.callerUserId } } as any },
      rctx.organizationId,
      permission,
    );
    if (!allowed) {
      return `${FORBIDDEN_PREFIX}caller lacks permission '${permission}' on organization ${rctx.organizationId}`;
    }
    return null;
  };

  const templateService = IngestionTemplateService.create(ctx.prisma);
  const bindingService = UserIngestionBindingService.create(ctx.prisma);

  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
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
      const rows = await templateService.listForUser({ organizationId: r.organizationId });
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
      const rows = await templateService.listForOrgAdmin({
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
      const row = await templateService.findByIdForOrg({
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
      source_type: z.string().describe("Lowercase + underscores. Discriminator that matches an upstream emitter (e.g. 'codex_internal')."),
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
      const row = await templateService.createOrgTemplate({
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
      const row = await templateService.updateOttlRules({
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
      const row = await templateService.cloneFromPlatform({
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
    "Soft-archive an org-authored template. Existing bindings continue to land traces; new installs are blocked. Requires aiTools:manage. Mirrors DELETE /api/governance/ingestion-templates/:id.",
    { id: z.string() },
    async ({ id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "aiTools:manage");
      if (denied) return text(denied);
      await templateService.archiveOrgTemplate({
        id,
        organizationId: r.organizationId,
        callerUserId: r.callerUserId!,
        surface: SURFACE,
      });
      return text(`archived ${id}`);
    },
  );

  // ── UserIngestionBinding ────────────────────────────────────────────

  server.tool(
    "governance_user_ingestion_bindings_list",
    "List the caller's own UserIngestionBindings. Requires OAuth-authenticated session. Mirrors GET /api/governance/user-ingestion-bindings.",
    {},
    async () => {
      const r = await resolve();
      if (!r.callerUserId) {
        return text(
          `${NEEDS_OAUTH_PREFIX}listing your own bindings requires an OAuth-authenticated MCP session.`,
        );
      }
      const denied = await requireRead(r, "organization:view");
      if (denied) return text(denied);
      const rows = await bindingService.listForCaller({
        callerUserId: r.callerUserId,
        organizationId: r.organizationId,
      });
      return json(rows);
    },
  );

  server.tool(
    "governance_user_ingestion_bindings_install",
    "Install a binding for the caller for the given template, returning the ik-lw-* token (shown ONCE). Requires OAuth-authenticated session + organization:view. Mirrors POST /api/governance/user-ingestion-bindings.",
    {
      template_id: z.string(),
    },
    async ({ template_id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "organization:view");
      if (denied) return text(denied);
      const result = await bindingService.install({
        callerUserId: r.callerUserId!,
        organizationId: r.organizationId,
        templateId: template_id,
        surface: SURFACE,
      });
      return json(result);
    },
  );

  server.tool(
    "governance_user_ingestion_bindings_uninstall",
    "Uninstall (archive) a UserIngestionBinding. Hard-cuts the binding token immediately. Requires OAuth-authenticated session. Mirrors DELETE /api/governance/user-ingestion-bindings/:id.",
    { binding_id: z.string() },
    async ({ binding_id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "organization:view");
      if (denied) return text(denied);
      await bindingService.uninstall({
        callerUserId: r.callerUserId!,
        organizationId: r.organizationId,
        bindingId: binding_id,
        surface: SURFACE,
      });
      return text(`uninstalled ${binding_id}`);
    },
  );

  server.tool(
    "governance_user_ingestion_bindings_rotate",
    "Hard-cut rotate the binding token. Returns the new ik-lw-* token (shown ONCE); the previous one is invalidated immediately. Mirrors POST /api/governance/user-ingestion-bindings/:id/rotate.",
    { binding_id: z.string() },
    async ({ binding_id }) => {
      const r = await resolve();
      const denied = await requirePermission(r, "organization:view");
      if (denied) return text(denied);
      const result = await bindingService.rotateToken({
        callerUserId: r.callerUserId!,
        organizationId: r.organizationId,
        bindingId: binding_id,
        surface: SURFACE,
      });
      return json(result);
    },
  );
}
