import type { AiToolEntry } from "./types";

/**
 * In-component mock catalog for Phase 7 B1-B8 scaffold work.
 *
 * Replace with `api.aiTools.list({ organizationId }).useQuery(...)` in B9
 * once Sergey's `aiToolsCatalogRouter` lands. See:
 *   .claude/AI-TOOLS-PORTAL-LANE-B-UI.md §6 "Open dependencies on Sergey's lane"
 */
export const MOCK_TOOL_CATALOG: AiToolEntry[] = [
  {
    id: "mock-claude-code",
    scope: "organization",
    scopeId: "mock-org",
    type: "coding_assistant",
    displayName: "Claude Code",
    slug: "claude-code",
    order: 1,
    enabled: true,
    config: {
      setupCommand: "langwatch claude",
      helperText:
        "Opens a browser to your LangWatch login, provisions a Personal Virtual Key bound to your default routing policy, and launches Claude Code with ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN set for you.",
    },
  },
  {
    id: "mock-codex",
    scope: "organization",
    scopeId: "mock-org",
    type: "coding_assistant",
    displayName: "Codex",
    slug: "codex",
    order: 2,
    enabled: true,
    config: {
      setupCommand: "langwatch codex",
    },
  },
  {
    id: "mock-cursor",
    scope: "organization",
    scopeId: "mock-org",
    type: "coding_assistant",
    displayName: "Cursor",
    slug: "cursor",
    order: 3,
    enabled: true,
    config: {
      setupCommand: "langwatch cursor",
    },
  },
  {
    id: "mock-gemini-cli",
    scope: "organization",
    scopeId: "mock-org",
    type: "coding_assistant",
    displayName: "Gemini CLI",
    slug: "gemini-cli",
    order: 4,
    enabled: true,
    config: {
      setupCommand: "langwatch gemini",
    },
  },
  {
    id: "mock-anthropic",
    scope: "organization",
    scopeId: "mock-org",
    type: "model_provider",
    displayName: "Anthropic",
    slug: "anthropic",
    order: 1,
    enabled: true,
    config: {
      providerKey: "anthropic",
      defaultLabel: "my-app",
      projectSuggestionText:
        "Building an application for your team? Consider creating a project instead — team-scoped budgets and shared usage make long-term sense for production traffic.",
    },
  },
  {
    id: "mock-openai",
    scope: "organization",
    scopeId: "mock-org",
    type: "model_provider",
    displayName: "OpenAI",
    slug: "openai",
    order: 2,
    enabled: true,
    config: { providerKey: "openai" },
  },
  {
    id: "mock-bedrock",
    scope: "organization",
    scopeId: "mock-org",
    type: "model_provider",
    displayName: "Bedrock",
    slug: "bedrock",
    order: 3,
    enabled: true,
    config: { providerKey: "bedrock" },
  },
  {
    id: "mock-copilot-studio",
    scope: "organization",
    scopeId: "mock-org",
    type: "external_tool",
    displayName: "Copilot Studio",
    slug: "copilot-studio",
    order: 1,
    enabled: true,
    config: {
      descriptionMarkdown:
        "Microsoft's low-code agent builder. Use this for internal RAG agents and process automation.\n\n# Getting started\n- Request access in #copilot-studio-onboarding\n- Agents are auto-instrumented; logs land in the LangWatch admin dashboard.",
      linkUrl: "https://copilotstudio.microsoft.com",
      ctaLabel: "Open Copilot Studio",
    },
  },
];
