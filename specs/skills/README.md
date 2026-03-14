# Skills Onboarding Initiative — Architecture

## Overview

LangWatch is moving from manual onboarding to agent-driven onboarding via AgentSkills-compliant skills, compiled prompts, and MCP integration. This document describes the architecture of the `skills/` folder.

## Directory Structure

```
skills/
├── instrument/                     # "Instrument my code with LangWatch"
│   └── SKILL.md                    # AgentSkills-compliant skill file
│
├── experiment/                     # "Create an evaluation experiment"
│   └── SKILL.md
│
├── scenario-test/                  # "Add agent simulation tests"
│   └── SKILL.md
│
├── prompt-versioning/              # "Version my agent prompts"
│   └── SKILL.md
│
├── red-team/                       # "Red team my agent for vulnerabilities"
│   └── SKILL.md
│
├── level-up/                       # Meta-skill: all of the above
│   └── SKILL.md
│
├── platform-experiment/            # Platform: "Create an experiment to test my prompt"
│   └── SKILL.md
│
├── platform-scenario/              # Platform: "Write scenario simulation tests"
│   └── SKILL.md
│
├── analytics/                      # "Tell me how my agent has been performing"
│   └── SKILL.md                    # Works for both devs and PMs
│
├── _shared/                        # Shared references (not a skill itself)
│   ├── mcp-setup.md                # LangWatch MCP installation for all agents
│   ├── api-key-setup.md            # How to obtain and configure API key
│   └── llms-txt-fallback.md        # How to read docs without MCP
│
├── _compiler/                      # Prompt compilation pipeline
│   ├── compile.ts                  # Node script to generate prompts from skills
│   ├── templates/
│   │   ├── platform.hbs            # Template with API key injection
│   │   └── docs.hbs                # Template with "ask for API key"
│   └── README.md
│
└── _tests/                         # Scenario tests for all skills
    ├── helpers/
    │   └── claude-code-adapter.ts  # Reusable Claude Code agent adapter
    ├── fixtures/                   # Minimal agent codebases for testing
    │   ├── python-openai/
    │   ├── python-langgraph/
    │   ├── python-agno/
    │   ├── python-litellm/
    │   ├── typescript-vercel/
    │   └── typescript-mastra/
    ├── instrument.scenario.test.ts
    ├── experiment.scenario.test.ts
    ├── scenario-test.scenario.test.ts
    ├── prompt-versioning.scenario.test.ts
    ├── red-team.scenario.test.ts
    ├── level-up.scenario.test.ts
    ├── platform-experiment.scenario.test.ts
    ├── platform-scenario.scenario.test.ts
    └── analytics.scenario.test.ts
```

## Design Principles

### 1. Skills are the source of truth
Every onboarding ability is defined as an AgentSkills-compliant skill. Prompts, docs references, and platform integrations are derived from skills.

### 2. No duplication — pull from docs
Skills do NOT duplicate framework patterns, anti-patterns, or reference material that lives in LangWatch/Scenario docs. Instead, they tell the agent to fetch docs via MCP. Agent bias corrections (e.g., "don't hallucinate frameworks") are embedded directly in each SKILL.md since they're core to every skill.

### 3. Compiled prompts for zero-friction onboarding
A compiler transforms skills into self-contained copy-paste prompts. Two modes:
- **Platform mode**: API key is injected as a literal value
- **Docs mode**: Agent is told to ask the user for their API key

### 4. MCP-first with graceful fallback
Skills tell the agent to install the LangWatch MCP for rich doc access. If MCP fails, the skill includes inline instructions or llms.txt-based doc fetching as a fallback.

### 5. Every improvement has a test
Each skill has scenario tests using Claude Code against fixture codebases. The testing pattern mirrors what's already in `mcp-server/tests/scenario-openai.test.ts`.

### 6. Dev skills write code, platform skills use platform tools
Dev skills (`instrument`, `experiment`, `scenario-test`, `prompt-versioning`, `red-team`) explicitly tell the agent to write code files. Platform skills (`platform-experiment`, `platform-scenario`) explicitly tell the agent to use `platform_` MCP tools. Cross-cutting skills (`analytics`) work in both contexts.

### 7. Agent generates content tailored to the user's application
Skills that create datasets, experiments, or tests generate content based on the user's actual codebase — not from static templates or sample files. This maximizes the "a-ha" moment.

## Relationship to Existing Systems

### MCP Server (`mcp-server/`)
Skills reference MCP for docs (fetch_langwatch_docs, fetch_scenario_docs) and platform operations (platform_create_*, etc.). The MCP is a runtime dependency, not a build-time one.

### Better Agents CLI
Better Agents scaffolds new projects from scratch. Skills are for existing projects. Better Agents knowledge templates inform skill content but the two don't share code — skills are standalone.

### Scenario & LangWatch Docs (`~/Projects/remote/scenario/docs`, `~/Projects/remote/langwatch-docs`)
Skills pull framework patterns and best practices from these docs via MCP. A change in docs affects skill performance — this is by design, not duplication.

### Platform Frontend
The `/onboarding` pages (built by another engineer) consume compiled prompts from the compiler. Empty state components in the platform also consume compiled prompts.

### Documentation Site
Docs pages link to skills/prompts. The four onboarding paths should be reflected in all getting-started content.

## Testing Strategy

### Test Infrastructure
- **Agent adapter**: Reusable Claude Code adapter (same pattern as `mcp-server/tests/`)
- **Fixtures**: Minimal agent codebases per language/framework combination
- **Assertions**: File content checks (deterministic) + JudgeAgent criteria (semantic)
- **Environment**: Tests run against production LangWatch for speed
- **Platform skill tests**: Run in empty temp directory (no codebase) to simulate claude web

### Test Matrix
Each skill is tested against relevant fixture combinations:

| Skill              | python-openai | python-langgraph | python-agno | ts-vercel | ts-mastra |
|--------------------|:---:|:---:|:---:|:---:|:---:|
| instrument         | ✓ | ✓ | ✓ | ✓ | ✓ |
| experiment         | ✓ | - | - | ✓ | - |
| scenario-test      | ✓ | - | - | ✓ | - |
| prompt-versioning  | ✓ | - | - | ✓ | - |
| red-team           | ✓ | - | - | ✓ | - |
| level-up           | ✓ | - | - | ✓ | - |

Platform skills (`platform-experiment`, `platform-scenario`, `analytics`) are tested in empty directories with MCP only.

### Running Tests
```bash
# All skill tests
cd skills/_tests && pnpm test

# Single skill
cd skills/_tests && pnpm test instrument.scenario.test.ts

# Single fixture
cd skills/_tests && pnpm test -- --grep "python-openai"
```

## Prompt Compilation Pipeline

### Input
One or more skill names + output mode (platform/docs) + optional API key.

### Process
1. Read SKILL.md files for the requested skills
2. Read `_shared/` references that skills point to
3. Deduplicate shared content (MCP setup appears once)
4. Apply the appropriate template (platform.hbs or docs.hbs)
5. Inject API key or "ask user" instructions

### Output
A self-contained prompt text that can be:
- Displayed on the onboarding page
- Shown in empty platform states
- Published in documentation
- Distributed via the skills directory

## Extensibility

Skills are designed to be extended over time:
- **New frameworks**: Add a fixture codebase + test case
- **New goals**: Create a new skill folder + SKILL.md + scenario test
- **Granular use cases**: e.g., "test my voice agent with LangWatch" → new skill
- **Customer requests**: Every customer request for a skill should become a skill + test
