---
name: connect-mcp
user-prompt: "Help me connect the LangWatch MCP"
description: Connect the LangWatch MCP server to the person's own AI client (Claude Desktop, claude.ai, Claude Code, ChatGPT, Cursor, VS Code with Copilot, or any other MCP client), so they can search traces, run evaluations and manage prompts from there. Shows the MCP setup card with this LangWatch's own MCP address, OAuth sign-in (recommended) or an API key, and the steps for their client, then fixes a connection that fails. Use when someone asks to set up, add or connect the LangWatch MCP, to use LangWatch from Claude, Cursor, ChatGPT, Copilot or their IDE, or why their MCP connection fails.
license: MIT
compatibility: Runs inside a Langy worker session only. Needs the mcp_setup tool.
metadata:
  category: skill
---

# Connect the LangWatch MCP

**Purpose**: get the LangWatch MCP server working in the AI client the person already uses, in one card, with the address of this LangWatch and the steps for their client.

**When to use**: the person wants LangWatch inside Claude, Cursor, ChatGPT, VS Code, Copilot or another MCP client ("set up MCP", "use LangWatch from Claude", "add LangWatch to Cursor"), or their MCP connection fails.

## Show the card

Your first call is `mcp_setup`, even when you do not know the client. Never ask which client they use, with the `question` tool or in text: the card's client picker is that question.

1. **Find the client.** Map what the person said to the card's client:

   | They said                                      | `client`      |
   | ---------------------------------------------- | ------------- |
   | Claude, Claude Desktop, claude.ai, Cowork      | `claude`      |
   | Claude Code                                    | `claude-code` |
   | ChatGPT                                        | `chatgpt`     |
   | Cursor                                         | `cursor`      |
   | VS Code, GitHub Copilot                        | `vscode`      |
   | Any other client (Windsurf, Zed, BoltAI, ...)  | `other`       |

   When they named no client, call the card without one: its client picker asks them, so do not ask the same thing with the `question` tool.

2. **Pick the method.** OAuth is the default and the recommendation. Pass `method: "api-key"` only when the person asked for a key, or for a headless or CI setup.

3. **Call `mcp_setup` once** with the client (when known) and the method (only for a key).

4. **Reply in one or two lines.** Point at the card and say why OAuth: no key to manage, access is tied to the person and the project they approve, and it refreshes itself. For example: "Pick your client in the card and follow its steps. Use OAuth: there's no key to manage, access is tied to you and the project you approve, and it renews itself."

Never type the MCP address, the steps or a command in the reply: the card carries all three for this LangWatch. Never take an address from your shell environment: it is the address only your sandbox reaches, not the one the person's client reaches. The card reads the right one in their browser.

## What the card says, for follow-up questions

- **Address**: this LangWatch's own address followed by `/mcp`, over Streamable HTTP. On LangWatch Cloud that is `https://app.langwatch.ai/mcp`; a self-hosted LangWatch uses its own host. The old `/sse` address is retired: a client still set to it should switch to `/mcp`.
- **OAuth (recommended)**: the client finds the sign-in on its own. The person clicks Connect, signs in to LangWatch in the browser and approves a project. Access is tied to the person and that project, and renews itself.
  - Claude Desktop or claude.ai: Customize, Connectors, + Add, Add custom connector, paste the address, Connect. On Team and Enterprise plans an owner adds it under Organization settings, Connectors.
  - Claude Code: `claude mcp add --transport http langwatch <address>`, then `/mcp` inside Claude Code to sign in.
  - ChatGPT (web): Plugins (Apps in older workspaces), +, Add custom MCP server, paste the address, choose OAuth, create it. On Business only admins and owners can add one; on Enterprise/Edu an admin can let selected members add one. Full MCP is on Business and Enterprise/Edu; Pro connects for read and fetch only, with developer mode on.
  - Cursor and VS Code with Copilot: add a remote server with the address; both run the sign-in themselves.
  - Any client that supports remote MCP with OAuth works the same way.
- **API key**: a personal API key from Settings, API Keys, sent as the header `Authorization: Bearer <key>`. For clients without OAuth, and for headless or CI use. Claude's custom connectors accept it under Request headers (on Team and Enterprise everyone shares that key, so OAuth is better there); ChatGPT takes OAuth only. VS Code can prompt for the key through an `inputs` entry with `password: true`, so it stays out of `.vscode/mcp.json`. A client that cannot send headers can run the local server, `npx -y @langwatch/mcp-server`, with the key in its environment.

When a follow-up needs a snippet for another client or the other method, call `mcp_setup` again with that client and method rather than writing it out. The person creates the key themselves: never ask for it, read it or make one.

## When the connection fails

| What the person sees                                   | What it means                                                         | What to say                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 401, unauthorized, or asked to sign in again           | The sign-in ended, or the API key is wrong or was revoked              | Reconnect and sign in again; with a key, create a new one and replace it                                      |
| 404 on a session, "session not found"                  | The session ended on the server; clients reconnect on their own        | Nothing to fix; if the client does not recover, reconnect it                                                  |
| A write tool answers `AUTH_REQUIRED`                   | The client connected with a project key, and writes need a person      | Connect with OAuth instead                                                                                   |
| The client cannot reach the server                     | The address is wrong (often an old `/sse` one) or not reachable        | Use the `/mcp` address from the card; claude.ai and ChatGPT connect from the internet, so a LangWatch on a private network needs a client on that network |

The full guide is at https://langwatch.ai/docs/integration/mcp, and the card links to it.
