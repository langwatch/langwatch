/**
 * mcp-client-probe.ts — exercises the governance MCP toolset over the
 * Streamable HTTP transport with project apiKey Bearer auth. Closes the
 * agentic-end-to-end dogfood gate: proves a real MCP client can reach
 * the in-process governance tools registered at handler.ts (Ask B-MCP
 * 7639b6c2b) and call them by name.
 *
 * Limitation: project-apiKey-only Bearer means write tools return
 * AUTH_REQUIRED (designed) — the OAuth flow at /api/mcp/authorize is
 * what mints a session with ctx.callerUserId. To exercise write tools
 * end-to-end as a real user, configure Claude Code's MCP server entry
 * (see _dogfood-runbook-mcp.md) which goes through the OAuth PKCE flow.
 *
 * Read-tool sweep is the fixture-fast-loop equivalent of sergey's B-4
 * REST integration test — same call shape, MCP transport.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE_URL = process.env.LANGWATCH_BASE_URL ?? "http://localhost:5560";
const API_KEY = process.env.LANGWATCH_API_KEY;

const GOVERNANCE_TOOL_PREFIX = "governance_";

if (!API_KEY) {
  console.error("LANGWATCH_API_KEY env var required (project apiKey, e.g. pkey_*)");
  process.exit(2);
}

void (async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  });

  const client = new Client({ name: "governance-dogfood-probe", version: "0.0.0" });
  console.error(`[probe] connecting to ${BASE_URL}/mcp …`);
  await client.connect(transport);
  console.error("[probe] connected");

  const { tools } = await client.listTools();
  const governanceTools = tools.filter((t) => t.name.startsWith(GOVERNANCE_TOOL_PREFIX));
  console.error(
    `[probe] tools registered: ${tools.length} total / ${governanceTools.length} governance`,
  );
  for (const t of governanceTools) {
    console.log(`  ${t.name}: ${t.description?.slice(0, 80) ?? ""}`);
  }

  const expected = [
    "governance_ingestion_templates_list",
    "governance_ingestion_templates_admin_list",
    "governance_ingestion_templates_get",
    "governance_ingestion_templates_create",
    "governance_ingestion_templates_update_ottl_rules",
    "governance_ingestion_templates_clone_from_platform",
    "governance_ingestion_templates_archive",
    "governance_user_ingestion_bindings_list",
    "governance_user_ingestion_bindings_install",
    "governance_user_ingestion_bindings_uninstall",
    "governance_user_ingestion_bindings_rotate",
  ];
  const missing = expected.filter((n) => !governanceTools.some((t) => t.name === n));
  if (missing.length > 0) {
    console.error(`[probe] MISSING tools: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.error("[probe] all 11 expected governance tools registered ✓");

  // Read tool: governance_ingestion_templates_list works on
  // project-apiKey-only sessions (see governance-tools.ts requireRead).
  console.error("\n[probe] calling governance_ingestion_templates_list …");
  const listResult = await client.callTool({
    name: "governance_ingestion_templates_list",
    arguments: {},
  });
  const listText = ((listResult.content ?? []) as Array<{
    type: string;
    text?: string;
  }>)
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("\n");
  console.log(listText.slice(0, 800));

  // Write tool without OAuth: should return AUTH_REQUIRED (fail-closed).
  console.error("\n[probe] calling governance_ingestion_templates_create (expect AUTH_REQUIRED) …");
  const createResult = await client.callTool({
    name: "governance_ingestion_templates_create",
    arguments: {
      source_type: "claude_code",
      display_name: "MCP Probe (should be rejected)",
      ottl_rules: "",
    },
  });
  const createText = ((createResult.content ?? []) as Array<{
    type: string;
    text?: string;
  }>)
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("\n");
  console.log(createText.slice(0, 400));
  if (!createText.startsWith("AUTH_REQUIRED")) {
    console.error("[probe] EXPECTED AUTH_REQUIRED but got something else");
    process.exit(1);
  }
  console.error("[probe] AUTH_REQUIRED returned as designed ✓");

  await client.close();
  console.error("\n[probe] done — read tools live, write tools fail-closed without OAuth");
})();
