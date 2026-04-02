---
name: feature-map
description: "Maintain the canonical LangWatch feature map (/feature-map.json). Use when adding features, APIs, MCP tools, CLI commands, or skills — to update the central registry and keep surfaces in sync."
user-invocable: true
argument-hint: "[what changed, e.g. 'added dataset MCP tools']"
---

# Feature Map Maintenance

You are maintaining `/feature-map.json` — the **canonical information architecture** for LangWatch. Every platform feature is defined here with its **surfaces** (how it's accessed) and **sync** state (how code and platform relate). All implementations (sidebar, docs, skills, MCP tools) derive from this map.

## Information Architecture

The hierarchy represents the product's mental model, not the code structure:

```
observability/         — Tracing, Analytics, User Events, Annotations
evaluations/           — Experiments, Online Evaluation (includes guardrails via code)
agent-simulations/     — Scenarios, Runs
prompt-management/     — Prompts, Prompt Playground
library/               — Agents, Workflows, Evaluators, Datasets
settings/              — Model Providers
```

### Key Design Decisions

1. **No "integrations" category** — SDKs/frameworks enable features, they aren't features themselves. Each feature declares its own SDK surface.
2. **Library** contains reusable components (evaluators, datasets, agents, workflows) — NOT "platform" catch-all.
3. **Annotations** live in Observability (they annotate traces).
4. **Guardrails** = online-evaluation accessed via code (`as_guardrail=True`), not a separate concept.
5. **Evaluators** and **Datasets** are in Library, not Evaluations — they're shared components used by experiments, online evaluation, and simulations.

### The Surfaces Model

Each feature has two main access paths:

- **`code`** — developer writes files in their project (SDK, CLI, skill)
- **`platform`** — no-code via UI or MCP tools (UI route, MCP tool, platform skill)

Plus cross-cutting:
- **`api`** — REST/Hono API endpoint namespace (used by both code and platform)
- **`docs`** — canonical documentation URL

Fields point to **namespaces**, not individual methods. E.g., `"python": "langwatch.experiment"` means the whole experiment module, not just `init()`.

### The Sync Model

How code and platform relate for each feature:

| sync value | meaning | example |
|---|---|---|
| `null` | separate or one-mode only | annotations (platform only) |
| `"bidirectional"` | code ↔ platform, synced | prompts (via `prompt sync`) |
| `"code-to-platform"` | code generates, platform displays | tracing, experiments |
| `"platform-to-code"` | platform configures, code consumes | — (none currently) |

`plannedSync` captures known future intent (e.g., scenarios will become `"bidirectional"`).

## Where to Find Things in the Codebase

### API Endpoints
- **Hono routes** (current): `langwatch/src/app/api/` — each `[[...route]]/app.ts` is a Hono app
  - traces: `langwatch/src/app/api/traces/[[...route]]/app.ts`
  - scenarios: `langwatch/src/app/api/scenarios/[[...route]]/app.ts`
  - prompts: `langwatch/src/app/api/prompts/[[...route]]/app.ts`
  - evaluators: `langwatch/src/app/api/evaluators/[[...route]]/app.ts`
  - datasets: `langwatch/src/app/api/dataset/[[...route]]/`
  - analytics: `langwatch/src/app/api/analytics/`
  - model-providers: `langwatch/src/app/api/model-providers/[[...route]]/`
- **Legacy Next.js routes** (being migrated): `langwatch/src/pages/api/`
- **tRPC routers**: `langwatch/src/server/api/routers/` registered in `langwatch/src/server/api/root.ts`

### Platform UI
- **Route definitions**: `langwatch/src/utils/routes.ts` — `projectRoutes` object has every page route
- **Sidebar menu**: `langwatch/src/components/MainMenu.tsx` — sections: Observe, Evaluate, Library
- **Feature icons**: `langwatch/src/utils/featureIcons.ts`

### MCP Tools
- **All tools**: `mcp-server/src/index.ts` — every `server.tool()` call
- **Tool handlers**: `mcp-server/src/tools/*.ts`
- Currently 21 tools: 2 docs, 1 discovery, 3 observability, 4 prompt, 5 scenario, 4 evaluator, 2 model-provider

### CLI Commands
- **Entry point**: `typescript-sdk/src/cli/index.ts`
- **Command implementations**: `typescript-sdk/src/cli/commands/`
- Currently: `login` + `prompt` subcommands (init, create, add, remove, list, sync, pull, push)

### SDKs
- **Python**: `python-sdk/src/langwatch/__init__.py` (top-level exports), modules: `experiment`, `evaluation`, `dataset`, `evaluators`, `prompts`, `dspy`
- **TypeScript**: `typescript-sdk/src/index.ts` — `LangWatch` class with `.prompts`, `.experiments`, `.evaluations`, `.evaluators`, `.datasets`, `.traces`
- **Scenario SDK** (separate): `@langwatch/scenario` (TS) / `langwatch-scenario` (Python)

### Skills (external, for users)
- **Location**: `skills/*/SKILL.md`
- **Feature skills**: tracing, evaluations, scenarios, prompts (each handles both code and platform approaches)
- **Meta skills**: level-up (orchestrates all feature skills)
- **Cross-cutting**: analytics

### Documentation
- **LangWatch docs**: served via `fetch_langwatch_docs` MCP tool, index at `https://langwatch.ai/docs/llms.txt`
- **Scenario docs**: served via `fetch_scenario_docs` MCP tool, index at `https://langwatch.ai/scenario/llms.txt`

## How to Update the Feature Map

### When a new API endpoint is added
1. Read `feature-map.json`
2. Find the feature entry by `id`
3. Update `surfaces.api` with the route namespace
4. If it's a new feature, create a new entry under the right category

### When a new MCP tool is added
1. Verify the tool exists in `mcp-server/src/index.ts`
2. Add the tool name to `surfaces.platform.mcp` array

### When a new skill is created
1. Verify the skill exists in `skills/{name}/SKILL.md`
2. Add to `surfaces.code.skill` (for code-path skills) or `surfaces.platform.skill` (for platform-path skills)

### When a new CLI command is added
1. Verify it exists in `typescript-sdk/src/cli/commands/`
2. Add to `surfaces.code.cli` array

### When SDK surface changes
1. Update `surfaces.code.sdk` with the namespace

### When sync capability changes
1. Move value from `plannedSync` to `sync`
2. Or set new `plannedSync` for future plans

### When a completely new feature is added
1. Decide which category it belongs to based on the hierarchy rules above
2. Create a new entry with all known surfaces
3. Set `sync` appropriately
4. Consider: does it need a skill? A docs page? MCP tool?

## Validation

After any change, verify:
- Every `api` value corresponds to a route in `langwatch/src/app/api/` or `langwatch/src/pages/api/`
- Every `mcp` tool name appears in `mcp-server/src/index.ts`
- Every `skill` name has a `skills/{name}/SKILL.md`
- Every `cli` command exists in `typescript-sdk/src/cli/`
- Every `ui` route exists in `langwatch/src/utils/routes.ts`
- No aspirational entries (use `plannedSync` for future intent)

## Task

$ARGUMENTS
