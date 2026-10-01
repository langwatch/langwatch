// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// MCP governance toolset: mirrors the REST shape, dispatches in-process through the app.
// RBAC at the tool layer; OAuth for writes, a project apiKey is enough for reads.

import type { AuthzPermission } from "@langwatch/authorization";
import {
  type GovernanceRestApi,
  TemplateNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type ZodRawShape, z } from "zod";

import type { GovernanceMcpPermissionProbe } from "../app/governance.members.ts";

type ToolResult = Promise<{ content: { type: "text"; text: string }[] }>;

/** The narrow shape of `@langwatch/mcp-server`'s McpServer these tools register on. */
export type GovernanceMcpServer = {
  tool<Shape extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    cb: (args: z.infer<z.ZodObject<Shape>>) => ToolResult,
  ): unknown;
};

type McpSession = {
  organizationId: string;
  /** Captured at /api/mcp/authorize; absent for project-apiKey-only sessions. */
  callerUserId?: string;
};

type SessionReader = () => Promise<McpSession>;

const SURFACE = "mcp" as const;
const FORBIDDEN_PREFIX = "FORBIDDEN: ";
const NEEDS_OAUTH_PREFIX = "AUTH_REQUIRED: ";
const NEEDS_OAUTH_FOR_WRITES = `${NEEDS_OAUTH_PREFIX}This governance MCP tool requires an OAuth-authenticated session (mint via /api/mcp/authorize). Project-apiKey-only sessions can use read tools but cannot perform writes.`;

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

type GovernanceMcpOperations = Pick<
  GovernanceRestApi,
  | "templateListForUser"
  | "templateListForOrgAdmin"
  | "templateGetByIdForOrg"
  | "templateCreateOrg"
  | "templateUpdateOttlRules"
  | "templateCloneFromPlatform"
  | "templateArchiveOrg"
  | "ingestionKeyList"
  | "ingestionKeyInstall"
  | "ingestionKeyRevoke"
>;

/** Registers the governance MCP tools on one session-scoped McpServer. */
export class GovernanceMcpToolsService {
  private constructor(
    private readonly projects: Pick<ProjectApi, "findIdByLegacyApiKey" | "getOrganizationId">,
    private readonly governance: GovernanceMcpOperations,
    private readonly permissions: GovernanceMcpPermissionProbe,
  ) {}

  static create({
    projects,
    governance,
    permissions,
  }: {
    projects: Pick<ProjectApi, "findIdByLegacyApiKey" | "getOrganizationId">;
    governance: GovernanceMcpOperations;
    permissions: GovernanceMcpPermissionProbe;
  }): GovernanceMcpToolsService {
    return new GovernanceMcpToolsService(projects, governance, permissions);
  }

  /** The caller's organization resolves from the apiKey on first use and is cached per session. */
  register({
    server,
    apiKey,
    callerUserId,
  }: {
    server: GovernanceMcpServer;
    apiKey: string;
    callerUserId: string | undefined;
  }): void {
    let resolved: Promise<McpSession> | undefined;
    const session: SessionReader = () => {
      resolved ??= this.resolveSession({ apiKey, callerUserId });
      return resolved;
    };
    this.registerTemplateReads(server, session);
    this.registerTemplateWrites(server, session);
    this.registerIngestionKeys(server, session);
  }

  /** A cross-organization probe answers null, as on main, rather than naming the template. */
  private async templateOrNull(input: { id: string; organizationId: string }) {
    try {
      return await this.governance.templateGetByIdForOrg(input);
    } catch (error) {
      if (error instanceof TemplateNotFoundError) return null;
      throw error;
    }
  }

  private async resolveSession({
    apiKey,
    callerUserId,
  }: {
    apiKey: string;
    callerUserId: string | undefined;
  }): Promise<McpSession> {
    const projectId = await this.projects.findIdByLegacyApiKey({ token: apiKey });
    if (projectId === null) {
      throw new Error(
        "MCP session apiKey did not resolve to a project — cannot derive organization context for governance tools.",
      );
    }
    const organizationId = await this.projects.getOrganizationId(projectId);
    return { organizationId, callerUserId };
  }

  private async forbiddenUnless(
    session: McpSession & { callerUserId: string },
    permission: AuthzPermission,
  ): Promise<string | null> {
    const allowed = await this.permissions.holdsOrganizationPermission({
      userId: session.callerUserId,
      organizationId: session.organizationId,
      permission,
    });
    return allowed
      ? null
      : `${FORBIDDEN_PREFIX}caller lacks permission '${permission}' on organization ${session.organizationId}`;
  }

  /** Writes need an OAuth user; the refusal text names why. */
  private async deniedWrite(session: McpSession, permission: AuthzPermission) {
    const { callerUserId } = session;
    if (!callerUserId) return NEEDS_OAUTH_FOR_WRITES;
    return this.forbiddenUnless({ ...session, callerUserId }, permission);
  }

  /** Reads run for project-apiKey sessions; a permission is only checked when a user is present. */
  private async deniedRead(session: McpSession, permission: AuthzPermission) {
    const { callerUserId } = session;
    if (!callerUserId) return null;
    return this.forbiddenUnless({ ...session, callerUserId }, permission);
  }

  /** Runs `act` for a write the caller may make, or answers the refusal. */
  private async write(
    session: SessionReader,
    permission: AuthzPermission,
    act: (caller: { organizationId: string; callerUserId: string }) => Promise<unknown>,
  ) {
    const current = await session();
    const denied = await this.deniedWrite(current, permission);
    if (denied || !current.callerUserId) return text(denied ?? NEEDS_OAUTH_FOR_WRITES);
    return json(await act({ ...current, callerUserId: current.callerUserId }));
  }

  private async read(
    session: SessionReader,
    permission: AuthzPermission,
    act: (organizationId: string) => Promise<unknown>,
  ) {
    const current = await session();
    const denied = await this.deniedRead(current, permission);
    if (denied) return text(denied);
    return json(await act(current.organizationId));
  }

  private registerTemplateReads(server: GovernanceMcpServer, session: SessionReader): void {
    server.tool(
      "governance_ingestion_templates_list",
      "List the user-visible ingestion templates for the caller's organization. Returns the union of platform-published defaults and any org-authored rows; excludes the OTTL source. Mirrors GET /api/governance/ingestion-templates.",
      {},
      () =>
        this.read(session, "aiTools:view", (organizationId) =>
          this.governance.templateListForUser({ organizationId }),
        ),
    );

    // The admin catalog carries the OTTL source (org config secret): it gates like a write,
    // so a project-apiKey session without a user identity is refused, not silently allowed.
    server.tool(
      "governance_ingestion_templates_admin_list",
      "Admin catalog read — same union as the user-visible list but INCLUDES ottlRules. Requires aiTools:manage. Mirrors GET /api/governance/ingestion-templates/admin.",
      {},
      () =>
        this.write(session, "aiTools:manage", ({ organizationId }) =>
          this.governance.templateListForOrgAdmin({ organizationId }),
        ),
    );

    server.tool(
      "governance_ingestion_templates_get",
      "Fetch a single ingestion template by id. Cross-org probes return null. Mirrors GET /api/governance/ingestion-templates/:id.",
      { id: z.string().describe("IngestionTemplate id") },
      ({ id }) =>
        this.read(session, "aiTools:view", (organizationId) =>
          this.templateOrNull({ id, organizationId }),
        ),
    );
  }

  private registerTemplateWrites(server: GovernanceMcpServer, session: SessionReader): void {
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
      (input) =>
        this.write(session, "aiTools:manage", (caller) =>
          this.governance.templateCreateOrg({
            ...caller,
            sourceType: input.source_type,
            displayName: input.display_name,
            description: input.description ?? null,
            iconAsset: input.icon_asset ?? null,
            credentialSchema: input.credential_schema ?? null,
            ottlRules: input.ottl_rules ?? "",
            surface: SURFACE,
          }),
        ),
    );

    server.tool(
      "governance_ingestion_templates_update_ottl_rules",
      "Update the ottlRules of an org-authored template. Platform rows are immutable. Requires aiTools:manage. Mirrors PATCH /api/governance/ingestion-templates/:id/ottl-rules.",
      {
        id: z.string(),
        ottl_rules: z.string().describe("New ottlRules body. Empty string permitted."),
      },
      ({ id, ottl_rules }) =>
        this.write(session, "aiTools:manage", (caller) =>
          this.governance.templateUpdateOttlRules({
            ...caller,
            id,
            ottlRules: ottl_rules,
            surface: SURFACE,
          }),
        ),
    );

    server.tool(
      "governance_ingestion_templates_clone_from_platform",
      "Clone a platform-published template into an editable org-authored row. Requires aiTools:manage. Mirrors POST /api/governance/ingestion-templates/:id/clone.",
      { source_template_id: z.string() },
      ({ source_template_id }) =>
        this.write(session, "aiTools:manage", (caller) =>
          this.governance.templateCloneFromPlatform({
            ...caller,
            sourceTemplateId: source_template_id,
            surface: SURFACE,
          }),
        ),
    );

    server.tool(
      "governance_ingestion_templates_archive",
      "Soft-archive an org-authored template. Existing ingestion keys continue to land traces; new installs are blocked. Requires aiTools:manage. Mirrors DELETE /api/governance/ingestion-templates/:id.",
      { id: z.string() },
      async ({ id }) => {
        const current = await session();
        const denied = await this.deniedWrite(current, "aiTools:manage");
        if (denied || !current.callerUserId) return text(denied ?? NEEDS_OAUTH_FOR_WRITES);
        await this.governance.templateArchiveOrg({
          id,
          organizationId: current.organizationId,
          callerUserId: current.callerUserId,
          surface: SURFACE,
        });
        return text(`archived ${id}`);
      },
    );
  }

  private registerIngestionKeys(server: GovernanceMcpServer, session: SessionReader): void {
    server.tool(
      "governance_ingestion_keys_list",
      "List the caller's live ingestion keys (one per connected source) in their personal project. Requires OAuth-authenticated session + organization:view.",
      {},
      async () => {
        const current = await session();
        const { callerUserId } = current;
        if (!callerUserId) {
          return text(
            `${NEEDS_OAUTH_PREFIX}listing your own ingestion keys requires an OAuth-authenticated MCP session.`,
          );
        }
        const denied = await this.deniedRead(current, "organization:view");
        if (denied) return text(denied);
        return json(
          await this.governance.ingestionKeyList({
            userId: callerUserId,
            organizationId: current.organizationId,
          }),
        );
      },
    );

    // Create-only: an agent asking for a key for the machine it runs on must not revoke the
    // key every other machine under this login exports with. The explicit rotate is on /me.
    server.tool(
      "governance_ingestion_keys_mint",
      "Mint an ingestion key for the caller's personal project + source_type, returning the ik-lw-* token (shown ONCE). Minting adds a key rather than replacing one, so the keys other machines already export with keep working. source_type must match a published ingestion template named by template_id; a tool the LangWatch CLI wraps (claude_code, codex, gemini, opencode, copilot_*) is refused here, because its key is minted by the CLI on the machine that runs it and retired with that machine's session. Requires OAuth-authenticated session + organization:view.",
      {
        source_type: z.string(),
        template_id: z.string().optional(),
      },
      ({ source_type, template_id }) =>
        this.write(session, "organization:view", ({ organizationId, callerUserId }) =>
          this.governance.ingestionKeyInstall({
            userId: callerUserId,
            organizationId,
            sourceType: source_type,
            ingestionTemplateId: template_id ?? null,
            surface: SURFACE,
          }),
        ),
    );

    // Answers main's plain-text line rather than JSON, as the template archive does.
    server.tool(
      "governance_ingestion_keys_revoke",
      "Revoke one of the caller's own ingestion keys by api_key_id (from governance_ingestion_keys_list). The token stops authorizing trace writes from that moment; past traces stay. Idempotent: a key already revoked stays revoked. Another person's key answers ingestion_key_not_found. Requires OAuth-authenticated session + organization:view.",
      { api_key_id: z.string() },
      async ({ api_key_id }) => {
        const current = await session();
        const denied = await this.deniedWrite(current, "organization:view");
        if (denied || !current.callerUserId) return text(denied ?? NEEDS_OAUTH_FOR_WRITES);
        await this.governance.ingestionKeyRevoke({
          userId: current.callerUserId,
          organizationId: current.organizationId,
          apiKeyId: api_key_id,
          surface: SURFACE,
        });
        return text(`revoked ${api_key_id}`);
      },
    );
  }
}
