/**
 * @vitest-environment node
 *
 * Audit-uniform regression for the governance MCP toolset (Ask B-MCP at
 * 7639b6c2b). Asserts the service-layer contract guaranteed by the
 * umbrella spec @audit-uniform: every state-changing MCP tool stamps
 * AuditLog.metadata.surface === 'mcp' end-to-end. Mirrors sergey B-4
 * (surface=hono) and the existing tRPC default (surface=trpc) — together
 * they pin all three governance entrypoints to a uniform audit shape.
 *
 * Per MO ruling on Path B: there is no MCP-over-HTTP wire to assert at,
 * so coverage lives at the service-layer where the surface enum is
 * actually consumed. This test invokes the registered tool callbacks
 * directly (mock McpServer captures them) and queries Postgres after.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       (@audit-uniform)
 */
import { OrganizationUserRole, RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import { registerGovernanceMcpTools } from "../governance-tools";

const suffix = nanoid(8);
const ORG_ID = `org-mcp-${suffix}`;
const ADMIN_ID = `usr-mcp-${suffix}`;
const PROJECT_ID = `prj-mcp-${suffix}`;
const TEAM_ID = `team-mcp-${suffix}`;
const PLATFORM_TEMPLATE_ID = `tmpl-platform-mcp-${suffix}`;
const API_KEY = `sk-lw-mcp-test-${suffix}`;

interface CapturedTool {
  name: string;
  description: string;
  schema: unknown;
  cb: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function mockMcpServer(): {
  tool: (
    name: string,
    description: string,
    schema: unknown,
    cb: CapturedTool["cb"],
  ) => unknown;
  tools: Map<string, CapturedTool>;
} {
  const tools = new Map<string, CapturedTool>();
  return {
    tool(name, description, schema, cb) {
      tools.set(name, { name, description, schema, cb });
      return null;
    },
    tools,
  };
}

async function call(
  mock: ReturnType<typeof mockMcpServer>,
  name: string,
  args: any,
): Promise<string> {
  const tool = mock.tools.get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const result = await tool.cb(args);
  return result.content.map((c) => c.text).join("\n");
}

describe("governance MCP tools — audit-uniform contract", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `MCP Audit ${suffix}`,
        slug: `mcp-audit-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        email: `mcp-admin-${suffix}@example.com`,
        name: "MCP Admin",
      },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    // Org-scoped RoleBinding — what hasOrganizationPermission resolves
    // for ADMIN-only perms like aiTools:manage. Without this, the legacy
    // OrganizationUser.role=ADMIN doesn't escalate (page-guard semantics
    // post alexis 0614a16c6).
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `MCP Team ${suffix}`,
        slug: `mcp-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `MCP Personal ${suffix}`,
        slug: `mcp-personal-${suffix}`,
        teamId: TEAM_ID,
        ownerUserId: ADMIN_ID,
        isPersonal: true,
        apiKey: API_KEY,
        language: "typescript",
        framework: "openai",
      },
    });
    await prisma.ingestionTemplate.create({
      data: {
        id: PLATFORM_TEMPLATE_ID,
        organizationId: null,
        slug: `platform_default_mcp_${suffix}`,
        sourceType: "claude_code",
        displayName: "Platform Default",
        iconAsset: "preset:claude_code",
        ottlRules: "",
        platformPublished: true,
        enabled: true,
      },
    });
  });

  describe("when an MCP tool authors a new template", () => {
    it("emits gateway.ingestion_template.created with metadata.surface=mcp", async () => {
      const mock = mockMcpServer();
      registerGovernanceMcpTools(mock as any, {
        prisma,
        apiKey: API_KEY,
        callerUserId: ADMIN_ID,
      });
      const out = await call(mock, "governance_ingestion_templates_create", {
        source_type: "claude_code",
        display_name: `MCP Authored ${suffix}`,
        ottl_rules: "",
      });
      expect(out).not.toMatch(/^FORBIDDEN|^AUTH_REQUIRED/);

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.created",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.metadata).toMatchObject({ surface: "mcp" });
    });
  });

  describe("when an MCP write tool runs without callerUserId", () => {
    it("returns AUTH_REQUIRED instead of attempting the service call", async () => {
      const mock = mockMcpServer();
      registerGovernanceMcpTools(mock as any, {
        prisma,
        apiKey: API_KEY,
        // callerUserId intentionally omitted — direct project apiKey only.
      });
      const out = await call(mock, "governance_ingestion_templates_create", {
        source_type: "claude_code",
        display_name: `Should not persist ${suffix}`,
        ottl_rules: "",
      });
      expect(out).toMatch(/^AUTH_REQUIRED/);

      const noLeak = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.created",
          metadata: { path: ["displayName"], equals: `Should not persist ${suffix}` },
        },
      });
      expect(noLeak).toBeNull();
    });
  });
});
