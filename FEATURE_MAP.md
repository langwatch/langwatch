# LangWatch Feature Map

Human-readable companion to [`feature-map.json`](./feature-map.json). The JSON is the source of truth — every skill, sidebar entry, MCP manifest, CLI, and docs index derives from it.

Near-complete coverage landed across three PRs:

- **[#3168](https://github.com/langwatch/langwatch/pull/3168)** — Full CLI, API, and MCP coverage for all platform features
- **[#3210](https://github.com/langwatch/langwatch/pull/3210)** — All platform features exposed via TypeScript and Python SDKs
- **[#3274](https://github.com/langwatch/langwatch/pull/3274)** — Skills made CLI-only, added `langwatch docs` / `scenario-docs` commands

## Information Architecture

```
observability/       — Tracing, Analytics, User Events, Annotations
evaluations/         — Experiments, Online Evaluation (guardrails via as_guardrail=True)
agent-simulations/   — Scenarios, Runs, Suites
prompt-management/   — Prompts, Prompt Playground
library/             — Agents, Workflows, Evaluators, Datasets
dashboards/          — Custom analytics dashboards
triggers/            — Automations / alerts
settings/            — Model Providers, Project Secrets
```

Design principles:

1. **No "integrations" category.** SDKs/frameworks enable features, they aren't features themselves.
2. **Library** holds reusable components used across experiments, simulations, and online evaluation.
3. **Annotations** live in Observability (they annotate traces).
4. **Guardrails** = online evaluation accessed via code (`as_guardrail=True`), not a separate concept.

## The Surfaces Model

Every feature has up to four surfaces:

| Surface | Meaning |
|---|---|
| **code** | Developer writes code in their project — SDK namespace, CLI subcommands, agent skill |
| **platform** | No-code via UI route, MCP tools (`platform_*`), platform-side skill |
| **api** | REST / Hono endpoint namespace (shared by code and platform) |
| **docs** | Canonical documentation URL |

Fields point to **namespaces**, not individual methods (e.g. `langwatch.experiment` covers the whole module).

## The Sync Model

| `sync` value | Meaning | Example |
|---|---|---|
| `null` | Separate or one-mode only | annotations (platform-only creation) |
| `bidirectional` | Code ↔ platform, synced | prompts (via `prompt sync`) |
| `code-to-platform` | Code generates, platform displays | tracing, experiments |
| `platform-to-code` | Platform configures, code consumes | — (none currently) |

`plannedSync` captures known future intent (e.g. scenarios will become `bidirectional`).

## Coverage Summary

Legend: ✅ present · — absent · `—` no SDK/CLI/skill/MCP by design

| Feature | SDK py | SDK ts | CLI | Skill (code) | UI | MCP | Skill (platform) | API | Docs |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Observability** | | | | | | | | | |
| Tracing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Analytics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| User Events | ✅ | — | — | — | — | — | — | ✅ | ✅ |
| Annotations | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| **Evaluations** | | | | | | | | | |
| Experiments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Online Evaluation (Monitors) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Agent Simulations** | | | | | | | | | |
| Scenarios | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Runs | — | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| Suites (Run Plans) | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| **Prompt Management** | | | | | | | | | |
| Prompts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Prompt Playground | — | — | — | — | ✅ | — | — | ✅ | ✅ |
| **Library** | | | | | | | | | |
| Agents | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| Workflows | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| Evaluators | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Datasets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Cross-cutting** | | | | | | | | | |
| Dashboards | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| Triggers | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| **Settings** | | | | | | | | | |
| Model Providers | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| Project Secrets | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |

### Coverage notes

- **User Events** — Python-only SDK (`langwatch.track_event`). No TS, CLI, UI, or MCP by design.
- **Prompt Playground** — Pure UI feature; no SDK/CLI/MCP planned.
- **Skills (platform side)** — Only `analytics`, `scenarios`, and `evaluators` have dedicated platform-side skills. Most features use shared platform skill conventions through MCP tools directly.
- **Docs** — A handful of features (agents, suites, dashboards, triggers, secrets) still lack canonical public docs pages.

## Where to Find Things

### API endpoints
- **Hono routes** — `platform/app/src/app/api/<namespace>/[[...route]]/app.ts`
- **Legacy Next.js routes** — `platform/app/src/pages/api/` (being migrated)
- **tRPC routers** — `platform/app/src/server/api/routers/` (registered in `root.ts`)

### Platform UI
- **Route definitions** — `platform/app/src/utils/routes.ts`
- **Sidebar menu** — `platform/app/src/components/MainMenu.tsx`
- **Feature icons** — `platform/app/src/utils/featureIcons.ts`

### MCP tools
- **All tools** — `mcp/typescript/src/index.ts` (every `server.tool(...)` call)
- **Handlers** — `mcp/typescript/src/tools/*.ts`

### CLI
- **Entry point** — `sdks/typescript/src/cli/index.ts`
- **Commands** — `sdks/typescript/src/cli/commands/`
- Meta commands: `login`, `status`, `docs`, `scenario-docs`

### SDKs
- **Python** — `sdks/python/src/langwatch/` (lazy-loaded facades in `__init__.py`)
- **TypeScript** — `sdks/typescript/src/index.ts` (`LangWatch` class with per-feature accessors)
- **Scenario SDK** — separate: `@langwatch/scenario` / `langwatch-scenario`

### Skills
- **Feature skills** — `skills/{tracing,evaluations,scenarios,prompts}/SKILL.md`
- **Cross-cutting** — `skills/{analytics,datasets}/SKILL.md`
- **Meta** — `skills/level-up/SKILL.md` (orchestrates the feature skills)
- **Recipes** — `skills/recipes/{debug-instrumentation,improve-setup,test-cli-usability,evaluate-multimodal,generate-rag-dataset,test-compliance}`

### Documentation
- **LangWatch docs** — index at `https://langwatch.ai/docs/llms.txt` (served via `fetch_langwatch_docs` MCP / `langwatch docs` CLI)
- **Scenario docs** — index at `https://langwatch.ai/scenario/llms.txt` (served via `fetch_scenario_docs` MCP / `langwatch scenario-docs` CLI)

## Maintaining the Map

When adding a feature or surface, update `feature-map.json` first — then update whatever derives from it (sidebar, skills, docs, this file). See `.claude/skills/feature-map/SKILL.md` for the update protocol.

Validation checklist:

- Every `api` value corresponds to a route in `platform/app/src/app/api/` or `platform/app/src/pages/api/`
- Every `mcp` tool name appears in `mcp/typescript/src/index.ts`
- Every `skill` name has a `skills/{name}/SKILL.md`
- Every `cli` command exists in `sdks/typescript/src/cli/`
- Every `ui` route exists in `platform/app/src/utils/routes.ts`
- No aspirational entries — use `plannedSync` for future intent
