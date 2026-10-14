/**
 * The `mcp_setup` tool puts up the card that connects the LangWatch MCP server to the person's
 * AI client. The card reads this deployment's own address in the browser, so the model never
 * types it. Spec: specs/langy/langy-mcp-setup.feature
 */

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const MCP_SETUP_TOOL_NAME = "mcp_setup";

/** The clients the card has steps for, in the order its picker lists them. */
export const MCP_SETUP_CLIENTS = [
  "claude",
  "claude-code",
  "chatgpt",
  "cursor",
  "vscode",
  "other",
] as const;

export const MCP_SETUP_METHODS = ["oauth", "api-key"] as const;

/** What the model reads once the card is up. */
export const MCP_SETUP_SHOWN =
  "The MCP setup card is shown. It carries this LangWatch's own MCP address with a copy button, a client picker, OAuth (recommended) or an API key, and the steps for the pick. Do not repeat the address, the steps or a command in your reply, and do not ask which client they use with the question tool: the card's picker already asks. One short line pointing at the card is enough.";

/** What the model reads when it named a client the card has no steps for. */
export const UNKNOWN_CLIENT_PUSHBACK = `Nothing was shown: the client is not one of ${MCP_SETUP_CLIENTS.join(", ")}. Pass one of those, "other" for any client not listed, or no client to let the person pick.`;

/** What the model reads when it named a method other than OAuth or an API key. */
export const UNKNOWN_METHOD_PUSHBACK = `Nothing was shown: the method is not one of ${MCP_SETUP_METHODS.join(", ")}. Leave it out to recommend OAuth.`;

export const MCP_SETUP_TOOL_DESCRIPTION = `Show the person the card that connects the LangWatch MCP server to their own AI client (Claude Desktop or claude.ai, Claude Code, ChatGPT, Cursor, VS Code with Copilot, or any other MCP client), so they can use LangWatch from it. The card shows this LangWatch's MCP address, OAuth sign-in (recommended) or an API key, and the steps for each client. Call it first, before any question: pass the client when the person named one, leave it out when they did not, and pass the method only when they asked for an API key. Never ask which client they use, with the question tool or in text: the card's client picker asks it. Use it whenever someone asks to set up the LangWatch MCP or to use LangWatch from Claude, Cursor, ChatGPT or their IDE.`;

const clientSchema = Type.Union(
  MCP_SETUP_CLIENTS.map((client) => Type.Literal(client)),
  {
    description:
      "The client the person named: claude (Claude Desktop or claude.ai), claude-code, chatgpt, cursor, vscode (VS Code or Copilot), or other. Leave it out when they named none.",
  },
);

const methodSchema = Type.Union(
  MCP_SETUP_METHODS.map((method) => Type.Literal(method)),
  {
    description:
      "oauth (the default, recommended) or api-key, only when the person asked for a key or a headless setup.",
  },
);

const mcpSetupParams = Type.Object({
  client: Type.Optional(clientSchema),
  method: Type.Optional(methodSchema),
});

function isOneOf<T extends string>(value: unknown, options: readonly T[]): boolean {
  return typeof value === "string" && options.some((option) => option === value);
}

/** What the tool answers, from the arguments alone, so it is pinned without a pi session. */
export function answerMcpSetup(params: unknown): { shown: boolean; text: string } {
  const args = typeof params === "object" && params !== null ? params : {};
  const client = "client" in args ? args.client : void 0;
  const method = "method" in args ? args.method : void 0;
  if (client !== void 0 && !isOneOf(client, MCP_SETUP_CLIENTS)) {
    return { shown: false, text: UNKNOWN_CLIENT_PUSHBACK };
  }
  if (method !== void 0 && !isOneOf(method, MCP_SETUP_METHODS)) {
    return { shown: false, text: UNKNOWN_METHOD_PUSHBACK };
  }
  return { shown: true, text: MCP_SETUP_SHOWN };
}

export function createMcpSetupExtension(): InlineExtension {
  return {
    name: "langy-mcp-setup",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: MCP_SETUP_TOOL_NAME,
        label: "MCP setup",
        description: MCP_SETUP_TOOL_DESCRIPTION,
        parameters: mcpSetupParams,
        async execute(_toolCallId, params) {
          const answer = answerMcpSetup(params);
          if (!answer.shown) throw new Error(answer.text);
          return { content: [{ type: "text" as const, text: answer.text }], details: {} };
        },
      });
    },
  };
}
