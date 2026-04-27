# ADR-012: Skills Information Architecture and Feature Map

**Date:** 2026-03-15

**Status:** Accepted

## Context

LangWatch is moving from manual onboarding to agent-driven onboarding via AgentSkills-compliant skills, compiled prompts, and MCP integration. This requires a canonical information architecture that all implementations (platform sidebar, docs, skills, MCP tools, CLI) derive from.

Three interconnected problems needed solving:

1. **Feature map**: No single source-of-truth listing all platform features and their availability across touchpoints (API, docs, skill, MCP tool, CLI command).
2. **Skills naming and organization**: Initial skill names were ad-hoc (`instrument`, `evaluation`, `scenario-test`, `prompt-versioning`, `platform-experiment`, `platform-scenario`, `red-team`). No scalable pattern.
3. **Code vs platform duality**: Many features exist in two modes (code: SDK/CLI in the user's project; platform: UI/MCP no-code). The relationship between modes varies per feature (synced, separate, one-way).

## Decision

### 1. Canonical Feature Map at `/feature-map.json`

We will maintain a single JSON file at the repository root that defines every platform feature with its **surfaces** and **sync** state. This is the canonical product definition — all other representations derive from it.

**Feature hierarchy** (6 top-level categories):

```
observability/         Tracing, Analytics, User Events, Annotations
evaluations/           Experiments, Online Evaluation (includes guardrails via code)
agent-simulations/     Scenarios, Runs
prompt-management/     Prompts, Prompt Playground
library/               Agents, Workflows, Evaluators, Datasets
settings/              Model Providers
```

Key structural decisions:
- **No "integrations" category** — SDKs/frameworks enable features, they aren't features themselves. Each feature declares its own SDK surface.
- **Library** contains reusable shared components (evaluators, datasets, agents, workflows).
- **Annotations** live in Observability (they annotate traces).
- **Guardrails** = online-evaluation accessed via code (`as_guardrail=True`), not a separate concept.

### 2. Surfaces Model

Each feature has two main access paths:

- **`code`** — developer writes files in their project (SDK, CLI, skill)
- **`platform`** — no-code via UI or MCP tools (UI route, MCP tool, platform skill)

Plus cross-cutting:
- **`api`** — REST/Hono API endpoint namespace
- **`docs`** — canonical documentation URL

Fields point to **namespaces**, not individual methods (e.g., `"python": "langwatch.experiment"` means the whole module).

### 3. Sync Model

The `sync` field captures how code and platform relate for each feature:

| Value | Meaning | Example |
|---|---|---|
| `null` | Separate or single-mode only | Annotations (platform only) |
| `"bidirectional"` | Code ↔ Platform, synced | Prompts (via `prompt sync`) |
| `"code-to-platform"` | Code generates, platform displays | Tracing, Experiments |
| `"platform-to-code"` | Platform configures, code consumes | (none currently) |

`plannedSync` captures known future intent (e.g., scenarios will become `"bidirectional"`).

### 4. Skills Named After Feature Map Leaf IDs

The naming pattern is: **skill name = feature map leaf ID**. The code/platform distinction is handled INSIDE the skill via disambiguation, not by separate skills.

| Skill | Feature Map ID | What it replaced |
|---|---|---|
| `tracing` | `observability.tracing` | `instrument` |
| `evaluations` | `evaluations.*` | `evaluation` + `platform-experiment` |
| `scenarios` | `agent-simulations.scenarios` | `scenario-test` + `platform-scenario` + `red-team` |
| `prompts` | `prompt-management.prompts` | `prompt-versioning` |
| `analytics` | `observability.analytics` | `analytics` (unchanged) |
| `level-up` | meta | `level-up` (unchanged) |

**6 skills instead of 9.** Each handles both code and platform approaches, and both onboarding (general setup) and targeted (specific addition) use cases.

### 5. Context Detection and Disambiguation Inside Skills

Each merged skill starts with two detection steps:

**Detect Context** (code vs platform):
1. Check if there's a codebase (package.json, pyproject.toml, etc.)
2. If YES → code approach (SDK, write files)
3. If NO → platform approach (MCP tools, no files)
4. If ambiguous → ask the user

**Determine Scope** (onboarding vs targeted):
- **General** ("add scenarios to my project"): Read full codebase, study git history, generate comprehensive coverage
- **Specific** ("test the refund flow"): Focus on the specific request, optionally fix agent code

### 6. Internal Maintenance Skill

An internal Claude skill at `.claude/skills/feature-map/SKILL.md` knows where every touchpoint lives in the codebase and how to update the feature map when features change.

## Rationale / Trade-offs

**Why merge code + platform into one skill?**
Users don't think in surfaces — they say "create a scenario" and the skill should figure out the right approach. Separate skills (`scenario-test` vs `platform-scenario`) forced users to choose upfront. One skill with disambiguation is more natural and easier to maintain.

**Why merge red-team into scenarios?**
Red teaming is a mode of scenario testing (using `RedTeamAgent` instead of `UserSimulatorAgent`), not a conceptually separate feature. Having it as a separate skill created confusion about when to use which.

**Why feature map at repo root?**
Not in `skills/` (broader than skills), not in `specs/` (not a spec), not in `docs/` (it defines docs, not the reverse). It's the canonical product definition.

**Why JSON not YAML/TOML?**
JSON is consumable by all our tools: the skills compiler, platform frontend, docs site, and agents. TypeScript/JavaScript ecosystem default.

**What we gave up:**
- Separate platform skills were simpler to write and test individually. The merged skills are more complex but better for users.
- The `instrument` name was intuitive as a user verb. `tracing` is the product concept, which aligns with the feature map but is slightly less action-oriented.

## Consequences

1. **All skill references must use the new names** — feature-map.json, compiler, specs, FEATURE-MAP.md, and internal skill all reference the 6 new names.

2. **Scenario tests need 3 categories per skill:**
   - Onboarding: "set this up from scratch"
   - Targeted: "add this specific thing"
   - Surface detection: "code vs platform" (for merged skills)

3. **The feature map becomes the single source of truth** for what the product offers. When adding a new feature, you update the feature map first, then build the surfaces it defines.

4. **Skills are extensible by adding entries to the feature map.** Customer requests like "test my voice agent" become new skills with new feature map entries.

5. **The information architecture is stable enough to restructure docs and sidebar** — both should derive from the feature map hierarchy.

## References

- Feature map: `/feature-map.json`
- Human-readable view: `/FEATURE-MAP.md`
- Internal maintenance skill: `.claude/skills/feature-map/SKILL.md`
- Skills: `skills/{tracing,evaluations,scenarios,prompts,analytics,level-up}/SKILL.md`
- Evaluations terminology: `dev/docs/terminology/001-evaluations.md`
- Platform sidebar: `langwatch/src/components/MainMenu.tsx`
- Platform routes: `langwatch/src/utils/routes.ts`
