# LangWatch Feature Map

Human-readable companion to [`feature-map.json`](./feature-map.json). The JSON is the source of truth — every skill, sidebar entry, MCP manifest, CLI, and docs index derives from it.

Near-complete coverage landed across three PRs:

- **[#3168](https://github.com/langwatch/langwatch/pull/3168)** — Full CLI, API, and MCP coverage for all platform features
- **[#3210](https://github.com/langwatch/langwatch/pull/3210)** — All platform features exposed via TypeScript and Python SDKs
- **[#3274](https://github.com/langwatch/langwatch/pull/3274)** — Skills made CLI-only, added `langwatch docs` / `scenario-docs` commands
- **[#4998](https://github.com/langwatch/langwatch/pull/4998)** — Go SDK brought to parity on tracing and the typed REST client, adding a third SDK surface

## Information Architecture

```
observability/       — Tracing, Analytics, User Events, Annotations
evaluations/         — Experiments, Online Evaluation (guardrails via as_guardrail=True)
agent-simulations/   — Scenarios, Runs, Test Suites, Run Plans
prompt-management/   — Prompts, Prompt Playground
library/             — Agents, Workflows, Evaluators, Datasets
dashboards/          — Custom analytics dashboards
triggers/            — Automations / alerts
ai-gateway/          — Virtual Keys, Budgets, Governance, Inventory (ingestion)
settings/            — Model Providers, Model Defaults, Project Secrets
```

Design principles:

1. **No "integrations" category.** SDKs/frameworks enable features, they aren't features themselves.
2. **Library** holds reusable components used across experiments, simulations, and online evaluation.
3. **Annotations** live in Observability (they annotate traces).
4. **Guardrails** = online evaluation accessed via code (`as_guardrail=True`), not a separate concept.

## The Surfaces Model

Every feature has up to four surfaces:

| Surface      | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| **code**     | Developer writes code in their project — SDK namespace, CLI subcommands, agent skill |
| **platform** | No-code via UI route, MCP tools (`platform_*`), platform-side skill                  |
| **api**      | REST / Hono endpoint namespace (shared by code and platform)                         |
| **docs**     | Canonical documentation URL                                                          |

Fields point to **namespaces**, not individual methods (e.g. `langwatch.experiment` covers the whole module).

## The Sync Model

| `sync` value       | Meaning                            | Example                              |
| ------------------ | ---------------------------------- | ------------------------------------ |
| `null`             | Separate or one-mode only          | annotations (platform-only creation) |
| `bidirectional`    | Code ↔ platform, synced            | prompts (via `prompt sync`)          |
| `code-to-platform` | Code generates, platform displays  | tracing, experiments                 |
| `platform-to-code` | Platform configures, code consumes | — (none currently)                   |

`plannedSync` captures known future intent (e.g. scenarios will become `bidirectional`).

## Coverage Summary

Legend: ✅ present · — absent · `—` no SDK/CLI/skill/MCP by design

| Feature                      | SDK py | SDK ts | SDK go | CLI | Skill (code) | UI  | MCP | Skill (platform) | API | Docs |
| ---------------------------- | :----: | :----: | :----: | :-: | :----------: | :-: | :-: | :--------------: | :-: | :--: |
| **Observability**            |        |        |        |     |              |     |     |                  |     |      |
| Tracing                      |   ✅   |   ✅   |   ✅   | ✅  |      ✅      | ✅  | ✅  |        —         | ✅  |  ✅  |
| Analytics                    |   ✅   |   ✅   |   —    | ✅  |      ✅      | ✅  | ✅  |        ✅        | ✅  |  ✅  |
| User Events                  |   ✅   |   —    |   ✅   |  —  |      —       |  —  |  —  |        —         | ✅  |  ✅  |
| Annotations                  |   ✅   |   ✅   |   ✅   | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  ✅  |
| **Evaluations**              |        |        |        |     |              |     |     |                  |     |      |
| Experiments                  |   ✅   |   ✅   |   —    | ✅  |      ✅      | ✅  | ✅  |        —         | ✅  |  ✅  |
| Online Evaluation (Monitors) |   ✅   |   ✅   |   ✅   | ✅  |      ✅      | ✅  | ✅  |        —         | ✅  |  ✅  |
| **Agent Simulations**        |        |        |        |     |              |     |     |                  |     |      |
| Scenarios                    |   ✅   |   ✅   |   ✅   | ✅  |      ✅      | ✅  | ✅  |        ✅        | ✅  |  ✅  |
| Runs                         |   —    |   ✅   |   ✅   | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  ✅  |
| Test Suites                  |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| Run Plans                    |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| **Prompt Management**        |        |        |        |     |              |     |     |                  |     |      |
| Prompts                      |   ✅   |   ✅   |   ✅   | ✅  |      ✅      | ✅  | ✅  |        —         | ✅  |  ✅  |
| Prompt Playground            |   —    |   —    |   —    |  —  |      —       | ✅  |  —  |        —         | ✅  |  ✅  |
| **Library**                  |        |        |        |     |              |     |     |                  |     |      |
| Agents                       |   ✅   |   ✅   |   —    | ✅  |      ✅      | ✅  | ✅  |        ✅        | ✅  |  ✅  |
| Workflows                    |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  ✅  |
| Evaluators                   |   ✅   |   ✅   |   —    | ✅  |      ✅      | ✅  | ✅  |        ✅        | ✅  |  ✅  |
| Datasets                     |   ✅   |   ✅   |   ✅   | ✅  |      ✅      | ✅  | ✅  |        —         | ✅  |  ✅  |
| **Cross-cutting**            |        |        |        |     |              |     |     |                  |     |      |
| Dashboards                   |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| Triggers                     |   ✅   |   ✅   |   ✅   | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| **AI Gateway**               |        |        |        |     |              |     |     |                  |     |      |
| Virtual Keys                 |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  ✅  |
| Budgets                      |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  ✅  |
| Governance                   |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  ✅  |
| Inventory (ingestion)        |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  ✅  |
| **Settings**                 |        |        |        |     |              |     |     |                  |     |      |
| Projects                     |   —    |   —    |   ✅   | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| Model Providers              |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  ✅  |
| Model Defaults               |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Project Secrets              |   ✅   |   ✅   |   —    | ✅  |      —       | ✅  | ✅  |        —         | ✅  |  —   |
| Agent Skills                 |   —    |   —    |   —    | ✅  |      —       |  —  |  —  |        —         |  —  |  ✅  |
| Organization                 |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Members and Invites          |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Teams                        |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Access Groups                |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Custom Roles                 |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| Role Bindings                |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |
| SCIM Provisioning            |   —    |   —    |   —    | ✅  |      —       | ✅  |  —  |        —         | ✅  |  —   |

### Coverage notes

- **User Events** — Python (`langwatch.track_event`) and Go (`client.Events`, plus `langwatch.Span.RecordEvent` on the tracing side). No TS, CLI, UI, or MCP by design.
- **SDK go** — The Go SDK splits across two modules: `github.com/langwatch/langwatch/sdks/go` (tracing, spans, evaluations, events, prompt telemetry, data-capture controls, and the eight provider instrumentations under `instrumentation/`) and `github.com/langwatch/langwatch/sdks/go/client` (the typed REST client, whose `Client` fields name the covered features). Table entries read `langwatch.*` for the tracing module and `client.*` for the REST client.
- **Go gaps** — Analytics, Experiments, Suites, Agents, Workflows, Evaluators, Dashboards, Model Providers, Project Secrets, Model Defaults, Agent Skills, API Keys, and every AI Gateway feature have no Go surface: the REST client exposes only Prompts, Datasets, Traces, Annotations, Events, Evaluations, Triggers, Monitors, Scenarios, and Projects.
- **Prompt Playground** — Pure UI feature; no SDK/CLI/MCP planned.
- **AI Gateway** — CLI/UI/API only (no SDK or MCP surface yet). `ingest` is read-only by design; `ingest install` is a hidden scripting primitive and deliberately not in the map.
- **Agent Skills** — CLI-only by design: `langwatch skills list/get/install/uninstall/update` installs the bundled agent skills (compiled from `skills/` into the CLI at build time) into `~/.agents/skills`. No platform surface — the skills repo (`langwatch/skills`) and `npx skills add` remain the browser-side distribution.
- **Organization management**: Organization, Members and Invites, Teams, Access Groups, Custom Roles, Role Bindings and SCIM Provisioning are the provisioning surface: CLI + REST + UI, no SDK or MCP. Two different gates apply, and they are not the same one:
  - The organization-scoped families (everything above except Teams) need an Enterprise plan, and answer `402 enterprise_plan_required` on any plan below it. Teams is ungated.
  - `langwatch organizations create|list|get` is a separate, plan-ungated family. It provisions organizations on a **self-hosted** instance and authenticates with the instance administrator credential (`LANGWATCH_INSTANCE_ADMIN_API_KEY`) rather than an organization API key, so it answers `404` wherever that credential is unset and on LangWatch Cloud, where the family does not exist at all. It is listed under Organization because it addresses the same resource.
- **Skills (platform side)** — Only `analytics`, `scenarios`, and `evaluators` have dedicated platform-side skills. Most features use shared platform skill conventions through MCP tools directly.
- **Docs**: The column tracks the feature's canonical guide page, not its API reference: every REST family gets generated reference pages under `docs/api-reference/`, so counting those would make the column say `✅` everywhere and measure nothing. A handful of features (suites, dashboards, triggers, secrets, model defaults) still lack canonical public docs pages, as do the organization management features.
- **CLI hints** — `surfaces.code.hints` is an optional per-command map (`"trace search" → example invocation`) on the agent-critical groups. It powers the CLI's machine-readable catalog (`langwatch commands`) and compact help tree (`langwatch help-tree`); additive only, consumers that don't know it ignore it.

## Where to Find Things

### API endpoints

- **Contracts and handlers** — the owning singular feature under
  `packages/features/<feature>/{contract,server}` or
  `packages/enterprise/features/<feature>/{contract,server}`
- **Transport composition** — `apps/api/`; compatibility routes still being
  drained from the application are tracked in the extraction ledger

### Platform UI

- **Reusable feature UI** — the owning feature's `web` package
- **Routing and process composition** — `apps/ui/`
- **Shared primitives** — `packages/design-system/`

### MCP tools

- **All tools** — `mcp/typescript/src/index.ts` (every `server.tool(...)` call)
- **Handlers** — `mcp/typescript/src/tools/*.ts`

### CLI

- **Entry point** — `sdks/typescript/src/cli/index.ts`
- **Commands** — `sdks/typescript/src/cli/commands/`
- Meta/plumbing commands (no feature-map coverage by design) are owned by `PLUMBING_COMMANDS` in `sdks/typescript/src/cli/utils/commandCatalog.ts` — the single list, enforced by the feature-map drift test.

### SDKs

- **Python** — `sdks/python/src/langwatch/` (lazy-loaded facades in `__init__.py`)
- **TypeScript** — `sdks/typescript/src/index.ts` (`LangWatch` class with per-feature accessors)
- **Go** — `sdks/go/` (tracing: `tracer.go`, `span.go`, `evaluation.go`, `event.go`, `datacapture.go`; instrumentations: `sdks/go/instrumentation/{openai,azureopenai,gopenai,anthropic,bedrock,googlegenai,ollama,genkit}`) and `sdks/go/client/` (`Client` struct in `client.go`, one file per service)
- **Scenario SDK** — separate: `@langwatch/scenario` / `langwatch-scenario`

### Skills

- **Feature skills** — `skills/{tracing,evaluations,scenarios,prompts}/SKILL.mdx`
- **Cross-cutting** — `skills/{analytics,datasets}/SKILL.mdx`
- **Meta** — `skills/level-up/SKILL.mdx` (orchestrates the feature skills)
- **Recipes** — `skills/recipes/{debug-instrumentation,improve-setup,test-cli-usability,evaluate-multimodal,generate-rag-dataset,test-compliance}`

### Documentation

- **LangWatch docs** — index at `https://langwatch.ai/docs/llms.txt` (served via `fetch_langwatch_docs` MCP / `langwatch docs` CLI)
- **Scenario docs** — index at `https://langwatch.ai/scenario/llms.txt` (served via `fetch_scenario_docs` MCP / `langwatch scenario-docs` CLI)

## Maintaining the Map

When adding a feature or surface, update `feature-map.json` first — then update whatever derives from it (sidebar, skills, docs, this file). Feature ownership itself is recorded in `packages/features/catalogue.json`.

Validation checklist:

- Every `api` value corresponds to an owning feature handler mounted by
  `apps/api`, or to a named compatibility adapter still recorded in the
  extraction ledger
- Every `mcp` tool name appears in `mcp/typescript/src/index.ts`
- Every `skill` name has a `skills/{name}/SKILL.mdx`
- Every `cli` command exists in `sdks/typescript/src/cli/`
- Every `ui` route is composed by `apps/ui`, or is recorded as residual UI in
  the extraction ledger
- No aspirational entries — use `plannedSync` for future intent
