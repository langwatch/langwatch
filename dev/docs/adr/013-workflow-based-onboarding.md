# ADR-013: Workflow-Based Onboarding with Skills and Recipes

**Date:** 2026-03-16

**Status:** Accepted

## Context

The initial docs onboarding split users by **identity**: "For Developers", "For Teams & PMs", "Use the Platform", "Manual Setup". This assumed that job title maps to tool choice, which was a reasonable assumption in 2024 but is wrong in 2026.

Today:
- CEOs use Claude Code to instrument their agents
- PMs use Cursor to write scenario tests
- "Non-technical" people prompt coding assistants to set up entire evaluation pipelines

Calling something "For Developers" scares away the CEO. Calling it "For Teams & PMs" gatekeeps the PM into a weaker path. Nobody self-identifies into marketing buckets when they just want to get something done.

## Decision

We will onboard users by **what tool they're already using**, not by who they are:

| Before (identity-based) | After (workflow-based) |
|---|---|
| "For Developers" | "Using a Coding Assistant" |
| "For Teams & PMs" | "Using a Chat Assistant" |
| "Choose Your Path" | "Quick Start" |

### Two paths, defined by tool capability

**Coding Assistant** (Claude Code, Copilot, Cursor, Codex, Windsurf, etc.):
The tool has file system access. It can edit code, run commands, create files. The agent instruments your code, writes tests, versions prompts. This path includes Skills and the Prompts CLI.

**Chat Assistant** (Claude on the web, ChatGPT, any conversational AI):
The tool has no file system access. It uses MCP tools to query analytics, create platform resources, set up evaluators. This path includes platform UI operations and MCP tools.

The distinction is **tool capability** (file access vs no file access), not user identity.

### Docs structure

```
LangWatch Skills/
├── Skills Directory     ← full list of skills with npx install commands
├── Code Prompts         ← copy-paste prompts for coding assistants
├── Platform Prompts     ← copy-paste prompts for chat assistants
└── Prompt Recipes       ← domain-specific recipes
```

"Manual Setup" moves out of Skills into the Integrations section (it's only about instrumentation).

### Two categories of skills

Two categories of skills emerged:
1. **Feature skills** -- map 1:1 to platform features (tracing, evaluations, scenarios, prompts)
2. **Recipes** -- domain-specific, use-case-specific actionable guides (test-compliance, generate-rag-dataset, debug-instrumentation)

We will organize skills into feature skills and recipes:
- Feature skills handle both code and platform approaches with disambiguation
- Recipes solve specific domain problems and are the 2026 evolution of cookbooks
- Both are AgentSkills-compliant and publishable to the skills directory
- Both compile into copy-paste prompts via the same compiler

Recipes live under `skills/recipes/{name}/` to distinguish them from feature skills at `skills/{name}/`.

### Language rules

- Never say "For Developers" or "For Teams" in navigation or page titles
- Say "Prompt Claude Code or Copilot to..." not "Developers can..."
- Say "Ask your chat assistant to..." not "PMs can..."
- Use tool names as examples (Claude Code, Copilot) rather than role names (developer, engineer)

## Rationale / Trade-offs

**Why not keep four paths?**
"Use the Platform" is a subset of the chat assistant path (it's "I'll do it in the browser myself"). "Manual Setup" is just instrumentation without an AI assistant — it belongs in Integrations, not in Skills.

**Why "Coding Assistant" / "Chat Assistant" not "IDE" / "Web"?**
Claude Code runs in a terminal, not an IDE. "Chat assistant" is broader than "web" (includes Slack bots, API integrations). The terms describe the interaction model, not the medium.

**What we give up:**
The role-based framing was instantly recognizable ("I'm a developer, that's my section"). The workflow framing requires a moment of thought ("which tool am I using?"). We believe this is a net positive because it includes more people and reduces the feeling of being gatekept.

## Consequences

1. All skills documentation uses workflow language, not role language
2. Cross-link callout tips on 24+ pages need updating
3. The "For Every Role" section on the introduction page is removed
4. Future skills and recipes follow the same pattern -- defined by what the tool can do, not who uses it
5. The feature-map.json `code.skill` / `platform.skill` split maps naturally to this (code = coding assistant, platform = chat assistant)
6. The skills directory grows organically as new recipes are added for customer requests
7. Every recipe should have scenario tests proving it works
8. Recipes reference feature skills when needed (e.g., test-compliance references the scenarios skill's Scenario SDK)
9. The docs site has a dedicated recipes page for browsing

## References

- ADR-012: Skills Information Architecture and Feature Map
- Feature map: `/feature-map.json`
- Skills: `skills/*/SKILL.md`
