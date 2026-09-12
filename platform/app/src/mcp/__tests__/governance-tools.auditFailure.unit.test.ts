/**
 * @vitest-environment node
 *
 * Pins the `.catch` half of #8097 on the MCP mint tool.
 *
 * `governance_ingestion_keys_mint` awaits its audit write so the row is
 * durable before the caller is told a key exists — that half is already
 * covered by `governance-tools.audit-uniform.integration.test.ts`, which
 * reads the row back out of the database.
 *
 * What that test cannot see is the cost of the await. The audit write is the
 * last thing the tool does, *after* `ingestionKeyService.mint` has created
 * the key and handed back the `ik-lw-*` token this response shows exactly
 * once. Awaiting it without a `.catch` would let a failed audit row throw
 * out of the tool and take the token with it: the key is live, nobody can
 * use it, and the caller cannot ask for it again. Losing the audit row is
 * bad; destroying the credential to avoid losing it is worse.
 *
 * This runs at unit level rather than against the database because nothing
 * here needs one: the tool's collaborators are all injected or imported, so
 * a fake MCP server that captures the callbacks is enough to make the audit
 * write fail on demand. A DB fixture would be slower and would prove less.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { registerGovernanceMcpTools } from "../governance-tools";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const PROJECT_API_KEY = "project-api-key";
const MINTED = {
  apiKeyId: "ik_1",
  token: "ik-lw-test-token",
  sourceType: "custom_agent",
};

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Permission is not what these cases are about; the caller is allowed.
vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeOrganizationPermission: vi.fn(async () => true),
}));

const services = vi.hoisted(() => ({
  mint: vi.fn(),
}));

vi.mock("@ee/governance/services/ingestionKey.service", () => ({
  IngestionKeyService: {
    create: () => ({ mint: services.mint, list: vi.fn(), revoke: vi.fn() }),
  },
}));

vi.mock("@ee/governance/services/ingestionTemplate.service", () => ({
  IngestionTemplateService: { create: () => ({ list: vi.fn() }) },
}));

/**
 * Keyed by action so only the mint's own row is failed. Every other
 * governance write on this server keeps working, which is what makes a red
 * run here point at the mint and nothing else.
 */
const { audit } = vi.hoisted(() => ({
  audit: { rejectAction: null as string | null },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (entry: { action: string }) => {
    if (entry.action === audit.rejectAction) {
      return Promise.reject(
        new Error(`audit write refused for ${entry.action}`),
      );
    }
    return Promise.resolve();
  },
}));

type ToolCallback = (
  args: any,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

/** Captures the tool callbacks the way the real McpServer would invoke them. */
function registerTools() {
  const tools = new Map<string, ToolCallback>();
  const server = {
    tool: (name: string, _description: string, _shape: any, cb: ToolCallback) =>
      tools.set(name, cb),
  };
  const prisma = {
    project: {
      findUnique: async () => ({ team: { organizationId: ORG_ID } }),
    },
  } as unknown as PrismaClient;

  registerGovernanceMcpTools(server, {
    prisma,
    apiKey: PROJECT_API_KEY,
    callerUserId: USER_ID,
  });

  return tools;
}

describe("governance MCP mint — a failed audit write does not cost the caller their key", () => {
  let tools: Map<string, ToolCallback>;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.rejectAction = null;
    services.mint.mockResolvedValue(MINTED);
    tools = registerTools();
  });

  it("still returns the token mint shows exactly once when the audit write fails", async () => {
    audit.rejectAction = "ingestionKey.mint";

    const result = await tools.get("governance_ingestion_keys_mint")!({
      source_type: MINTED.sourceType,
    });

    expect(services.mint).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      apiKeyId: MINTED.apiKeyId,
      token: MINTED.token,
    });
  });
});
