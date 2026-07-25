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
ai-gateway/          — Virtual Keys, Budgets, Governance, Ingestion Sources
settings/            — Model Providers, Model Defaults, Project Secrets
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
| **AI Gateway** | | | | | | | | | |
| Virtual Keys | — | — | ✅ | — | ✅ | — | — | ✅ | ✅ |
| Budgets | — | — | ✅ | — | ✅ | — | — | ✅ | ✅ |
| Governance | — | — | ✅ | — | ✅ | — | — | ✅ | ✅ |
| Ingestion Sources | — | — | ✅ | — | ✅ | — | — | ✅ | ✅ |
| **Settings** | | | | | | | | | |
| Model Providers | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ |
| Model Defaults | — | — | ✅ | — | ✅ | — | — | ✅ | — |
| Project Secrets | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | — |
| Agent Skills | — | — | ✅ | — | — | — | — | — | ✅ |

### Coverage notes

- **User Events** — Python-only SDK (`langwatch.track_event`). No TS, CLI, UI, or MCP by design.
- **Prompt Playground** — Pure UI feature; no SDK/CLI/MCP planned.
- **AI Gateway** — CLI/UI/API only (no SDK or MCP surface yet). `ingest` is read-only by design; `ingest install` is a hidden scripting primitive and deliberately not in the map.
- **Agent Skills** — CLI-only by design: `langwatch skills list/get/install/uninstall/update` installs the bundled agent skills (compiled from `skills/` into the CLI at build time) into `~/.agents/skills`. No platform surface — the skills repo (`langwatch/skills`) and `npx skills add` remain the browser-side distribution.
- **Skills (platform side)** — Only `analytics`, `scenarios`, and `evaluators` have dedicated platform-side skills. Most features use shared platform skill conventions through MCP tools directly.
- **Docs** — A handful of features (agents, suites, dashboards, triggers, secrets, model defaults) still lack canonical public docs pages.
- **CLI hints** — `surfaces.code.hints` is an optional per-command map (`"trace search" → example invocation`) on the agent-critical groups. It powers the CLI's machine-readable catalog (`langwatch commands`) and compact help tree (`langwatch help-tree`); additive only, consumers that don't know it ignore it.

## Where to Find Things

### API endpoints
- **Hono routes** — `langwatch/src/app/api/<namespace>/[[...route]]/app.ts`
- **Legacy Next.js routes** — `langwatch/src/pages/api/` (being migrated)
- **tRPC routers** — `langwatch/src/server/api/routers/` (registered in `root.ts`)

### Platform UI
- **Route definitions** — `langwatch/src/utils/routes.ts`
- **Sidebar menu** — `langwatch/src/components/MainMenu.tsx`
- **Feature icons** — `langwatch/src/utils/featureIcons.ts`

### MCP tools
- **All tools** — `mcp-server/src/index.ts` (every `server.tool(...)` call)
- **Handlers** — `mcp-server/src/tools/*.ts`

### CLI
- **Entry point** — `typescript-sdk/src/cli/index.ts`
- **Commands** — `typescript-sdk/src/cli/commands/`
- Meta/plumbing commands (no feature-map coverage by design) are owned by `PLUMBING_COMMANDS` in `typescript-sdk/src/cli/utils/commandCatalog.ts` — the single list, enforced by the feature-map drift test.

### SDKs
- **Python** — `python-sdk/src/langwatch/` (lazy-loaded facades in `__init__.py`)
- **TypeScript** — `typescript-sdk/src/index.ts` (`LangWatch` class with per-feature accessors)
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

- Every `api` value corresponds to a route in `langwatch/src/app/api/` or `langwatch/src/pages/api/`
- Every `mcp` tool name appears in `mcp-server/src/index.ts`
- Every `skill` name has a `skills/{name}/SKILL.md`
- Every `cli` command exists in `typescript-sdk/src/cli/`
- Every `ui` route exists in `langwatch/src/utils/routes.ts`
- No aspirational entries — use `plannedSync` for future intent
