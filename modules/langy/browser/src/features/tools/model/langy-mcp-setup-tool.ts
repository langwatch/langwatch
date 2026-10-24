/**
 * The `mcp_setup` tool is the MCP setup card: which calls draw one, and the steps the card shows
 * for each client and sign-in method. The address is this deployment's own, never the model's.
 * Spec: specs/langy/langy-mcp-setup.feature
 */
import { z } from "zod";

export const LANGY_MCP_SETUP_TOOL_NAME = "mcp_setup";

/** The public guide the card's "Full guide" link opens. */
export const LANGWATCH_MCP_DOCS_URL = "https://langwatch.ai/docs/integration/mcp";

/** Where a person creates the personal API key the key method sends. */
export const LANGWATCH_API_KEYS_PATH = "/settings/api-keys";

/** The VS Code input that prompts for the key, so it stays out of the workspace file. */
const VSCODE_API_KEY_INPUT = "langwatch-api-key";

/** What stands in for the key in every snippet the card shows, bar VS Code's prompt. */
export const MCP_API_KEY_PLACEHOLDER = "YOUR_API_KEY";

export const MCP_SETUP_CLIENTS = [
  "claude",
  "claude-code",
  "chatgpt",
  "cursor",
  "vscode",
  "other",
] as const;

export type McpSetupClient = (typeof MCP_SETUP_CLIENTS)[number];

export type McpSetupMethod = "oauth" | "api-key";

export const MCP_SETUP_CLIENT_LABELS: Record<McpSetupClient, string> = {
  claude: "Claude Desktop / claude.ai",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  vscode: "VS Code / Copilot",
  other: "Other",
};

export interface LangyMcpSetupCall {
  callId: string;
  /** The client Langy already knows the person uses, or null to let them pick. */
  client: McpSetupClient | null;
  method: McpSetupMethod;
}

/** One step of the setup: a sentence, and a snippet to copy when the step has one. */
export interface McpSetupStep {
  text: string;
  code?: string;
  /** A page of this application the step points at. */
  link?: { label: string; href: string };
}

const toolPartSchema = z.object({
  type: z.string(),
  toolName: z.string().optional(),
  state: z.string().optional(),
  toolCallId: z.string().optional(),
  input: z.unknown(),
});

const mcpSetupInputSchema = z.object({
  client: z.enum(MCP_SETUP_CLIENTS).optional(),
  method: z.enum(["oauth", "api-key"]).optional(),
});

/** A call still streaming its input, or one the worker refused, draws no card. */
const DRAWN_STATES = new Set(["input-available", "output-available"]);

function readToolPart(part: unknown) {
  const parsed = toolPartSchema.safeParse(part);
  if (!parsed.success) return null;
  const { type, toolName } = parsed.data;
  const named =
    type === `tool-${LANGY_MCP_SETUP_TOOL_NAME}` ||
    (type === "dynamic-tool" && toolName === LANGY_MCP_SETUP_TOOL_NAME);
  return named ? parsed.data : null;
}

/** Is this part Langy's `mcp_setup` tool call? */
export function isMcpSetupToolPart(part: unknown): boolean {
  return readToolPart(part) !== null;
}

/** The MCP setup calls a message carries, one card each. */
export function mcpSetupCalls(parts: readonly unknown[]): LangyMcpSetupCall[] {
  const calls: LangyMcpSetupCall[] = [];
  for (const part of parts) {
    const toolPart = readToolPart(part);
    if (!toolPart || !DRAWN_STATES.has(toolPart.state ?? "")) continue;
    const input = mcpSetupInputSchema.safeParse(toolPart.input ?? {});
    if (!input.success) continue;
    calls.push({
      callId: toolPart.toolCallId ?? LANGY_MCP_SETUP_TOOL_NAME,
      client: input.data.client ?? null,
      method: input.data.method ?? "oauth",
    });
  }
  return calls;
}

/** This deployment's MCP address: its public base URL and `/mcp`. */
export function mcpServerUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/mcp`;
}

/** The header a client without OAuth sends with every request. */
export function mcpAuthorizationHeader(): string {
  return `Authorization: Bearer ${MCP_API_KEY_PLACEHOLDER}`;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const SIGN_IN_STEP: McpSetupStep = {
  text: "Sign in to LangWatch in the browser window that opens, and approve the project the client may use.",
};

function oauthSteps({ client, url }: { client: McpSetupClient; url: string }): McpSetupStep[] {
  switch (client) {
    case "claude":
      return [
        {
          text: "In Claude Desktop or claude.ai, open Customize, then Connectors, click + Add and choose Add custom connector. On Team and Enterprise plans an owner adds it under Organization settings, Connectors.",
        },
        { text: "Name it LangWatch, paste the URL above and click Connect." },
        SIGN_IN_STEP,
      ];
    case "claude-code":
      return [
        { text: "Add the server:", code: `claude mcp add --transport http langwatch ${url}` },
        { text: "In Claude Code, run /mcp, pick langwatch and choose Authenticate." },
        SIGN_IN_STEP,
      ];
    case "chatgpt":
      return [
        {
          text: "In ChatGPT on the web, open Plugins (Apps in older workspaces), click + and choose Add custom MCP server. On Business only admins and owners can add one; on Enterprise/Edu an admin can let selected members add one. Full MCP is on Business and Enterprise/Edu; Pro connects for read and fetch only, with developer mode on.",
        },
        { text: "Paste the URL above, choose OAuth as the authentication and create it." },
        SIGN_IN_STEP,
      ];
    case "cursor":
      return [
        {
          text: "Open Cursor Settings, then Tools & MCP, and add a new MCP server. Or add this to ~/.cursor/mcp.json:",
          code: json({ mcpServers: { langwatch: { url } } }),
        },
        { text: "Click Connect next to langwatch." },
        SIGN_IN_STEP,
      ];
    case "vscode":
      return [
        {
          text: "Run MCP: Add Server from the Command Palette, choose HTTP and paste the URL above. Or add this to .vscode/mcp.json:",
          code: json({ servers: { langwatch: { type: "http", url } } }),
        },
        { text: "Start the server and allow it to sign in when VS Code asks." },
        SIGN_IN_STEP,
      ];
    case "other":
      return [
        { text: "Add a remote MCP server with the URL above. Its transport is Streamable HTTP." },
        { text: "Choose OAuth when the client asks how to sign in, then connect." },
        SIGN_IN_STEP,
      ];
  }
}

function apiKeySteps({
  client,
  url,
  appBaseUrl,
}: {
  client: McpSetupClient;
  url: string;
  appBaseUrl: string;
}): McpSetupStep[] {
  const createKey: McpSetupStep = {
    text: "Create a personal API key. Its Permissions start at All: choose Restricted and grant only what your AI client needs, such as Read on the projects you want it to see.",
    link: { label: "Settings, API Keys", href: LANGWATCH_API_KEYS_PATH },
  };
  const bearer = `Bearer ${MCP_API_KEY_PLACEHOLDER}`;
  const endpoint = appBaseUrl.replace(/\/+$/, "");
  switch (client) {
    case "claude":
      return [
        createKey,
        {
          text: "Add a custom connector as for OAuth, paste the URL above, and under Request headers add this header:",
          code: `Authorization: ${bearer}`,
        },
        {
          text: "On Team and Enterprise plans everyone in the organization shares this key, so OAuth is the better choice there.",
        },
      ];
    case "claude-code":
      return [
        createKey,
        {
          text: "Add the server with the key as a header:",
          code: `claude mcp add --transport http langwatch ${url} --header "Authorization: ${bearer}"`,
        },
      ];
    case "chatgpt":
      return [
        {
          text: "ChatGPT's connectors sign in with OAuth and take no API key. Choose OAuth above to connect ChatGPT.",
        },
      ];
    case "cursor":
      return [
        createKey,
        {
          text: "Add this to ~/.cursor/mcp.json:",
          code: json({ mcpServers: { langwatch: { url, headers: { Authorization: bearer } } } }),
        },
      ];
    case "vscode":
      return [
        createKey,
        {
          text: "Add this to .vscode/mcp.json. VS Code asks for the key once and keeps it in its secret storage, so the key never lands in the file:",
          code: json({
            inputs: [
              {
                type: "promptString",
                id: VSCODE_API_KEY_INPUT,
                description: "LangWatch API key",
                password: true,
              },
            ],
            servers: {
              langwatch: {
                type: "http",
                url,
                headers: { Authorization: `Bearer \${input:${VSCODE_API_KEY_INPUT}}` },
              },
            },
          }),
        },
      ];
    case "other":
      return [
        createKey,
        {
          text: "Add a remote MCP server with the URL above, and send this header with it:",
          code: mcpAuthorizationHeader(),
        },
        {
          text: "A client that cannot send headers can run the local server instead:",
          code: `LANGWATCH_API_KEY=${MCP_API_KEY_PLACEHOLDER} LANGWATCH_ENDPOINT=${endpoint} npx -y @langwatch/mcp-server`,
        },
      ];
  }
}

/** The steps for one client and sign-in method, with this deployment's addresses filled in. */
export function mcpSetupSteps({
  client,
  method,
  appBaseUrl,
}: {
  client: McpSetupClient;
  method: McpSetupMethod;
  appBaseUrl: string;
}): McpSetupStep[] {
  const url = mcpServerUrl(appBaseUrl);
  return method === "oauth"
    ? oauthSteps({ client, url })
    : apiKeySteps({ client, url, appBaseUrl });
}
