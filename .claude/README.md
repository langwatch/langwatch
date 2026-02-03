# Claude Code Orchestration System

This document explains how Claude Code agents and skills work together in this repository.

## Architecture Overview

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN THREAD (Orchestrator)                                         │
│  - Holds requirements                                               │
│  - Delegates code work to agents                                    │
│  - Verifies outcomes                                                │
│  - Does NOT read/write code directly                                │
└─────────────────────────────────────────────────────────────────────┘
     │                         │                         │
     │ /code                   │ /review                 │ /e2e
     ▼                         ▼                         ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│  CODER AGENT     │  │  UNCLE-BOB-      │  │  E2E WORKFLOW            │
│  (context: fork) │  │  REVIEWER        │  │  (coordinates agents)    │
│  - TDD workflow  │  │  (context: fork) │  │  - planner → generator   │
│  - Returns       │  │  - SOLID/TDD     │  │  - healer → reviewer     │
│    summary       │  │  - Returns       │  │  - Returns test status   │
│                  │  │    findings      │  │                          │
└──────────────────┘  └──────────────────┘  └──────────────────────────┘
```

## Directory Structure

```
.claude/
├── agents/         # Agent definitions (personas with workflows)
│   ├── coder.md
│   ├── repo-sherpa.md
│   ├── uncle-bob-reviewer.md
│   ├── playwright-test-planner.md    # E2E: explores app, creates plans
│   ├── playwright-test-generator.md  # E2E: generates tests from plans
│   ├── playwright-test-healer.md     # E2E: fixes failing tests
│   └── test-reviewer.md              # E2E: reviews test quality
├── skills/         # Skills (entry points that invoke agents)
│   ├── orchestrate/    # Manual: /orchestrate <requirements>
│   ├── implement/      # Manual: /implement #123 (invokes /orchestrate)
│   ├── code/           # Delegates to coder agent
│   ├── test-review/    # Delegates to test-reviewer agent
│   ├── review/         # Delegates to uncle-bob-reviewer
│   ├── sherpa/         # Delegates to repo-sherpa
│   └── e2e/            # Coordinates E2E test generation workflow
└── commands/       # Slash commands (non-agent utilities)
```

## Concepts

### Agents (.claude/agents/)

Agents are **specialized personas** with defined workflows and expertise. They run in isolated context forks and return structured summaries.

| Agent | Purpose | Model |
|-------|---------|-------|
| `coder` | TDD implementation, self-verification | Opus |
| `uncle-bob-reviewer` | SOLID/Clean Code review | Opus |
| `repo-sherpa` | Documentation, DX, meta-layer | Opus |
| `playwright-test-planner` | Explore live app, create test plans | Opus |
| `playwright-test-generator` | Generate Playwright tests from plans | Sonnet |
| `playwright-test-healer` | Debug and fix failing tests | Sonnet |
| `test-reviewer` | Review test quality and pyramid placement | Opus |

Agents are invoked **only through skills**, never directly (except E2E agents which are invoked via Task tool from the `/e2e` skill).

### Skills (.claude/skills/)

Skills are **entry points** that:
1. Accept user commands (`/code`, `/review`, `/sherpa`)
2. Invoke agents via `context: fork` + `agent: <name>`
3. Pass arguments to the agent

**Key frontmatter properties:**
```yaml
---
name: code
context: fork        # Creates isolated context
agent: coder         # Agent to invoke
user-invocable: true # Can be triggered with /code
---
```

### The Delegation Pattern

Skills bridge user commands to agents:

```
/code "implement login"
    │
    ▼
skills/code/SKILL.md
    │ context: fork
    │ agent: coder
    ▼
agents/coder.md (runs in fork)
    │
    ▼
Returns summary to main thread
```

## Orchestration Workflow

When implementing features, the main thread becomes an **orchestrator** that manages the loop:

### Activation (Opt-In)

Orchestration mode is explicit - use one of:
1. `/orchestrate <requirements>` - Direct entry with any requirements
2. `/implement #123` - Entry point for GitHub issues (invokes `/orchestrate`)

### The Loop

```
┌─────────────────────────────────────────────────────────┐
│ 1. PLAN                                                 │
│    - Check for feature file in specs/features/         │
│    - If missing → /plan to create one                   │
│    - Read feature file for acceptance criteria          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 2. TEST-REVIEW                                          │
│    - /test-review validates pyramid placement           │
│    - Checks @e2e, @integration, @unit appropriateness   │
│    - Violations? → fix feature file, re-review          │
│    - Approved? → Continue                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 3. IMPLEMENT                                            │
│    - /code with feature file and requirements           │
│    - Coder implements with TDD, returns summary         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 4. VERIFY                                               │
│    - Check summary against acceptance criteria          │
│    - Incomplete? → /code again with feedback            │
│    - Max 3 iterations, then escalate                    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 5. REVIEW                                               │
│    - /review for quality gate                           │
│    - Issues? → /code with reviewer feedback             │
│    - Approved? → Continue                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 6. E2E VERIFICATION (if @e2e scenarios exist)           │
│    - /e2e with feature file path                        │
│    - Explores live app → generates tests → heals        │
│    - All tests pass? → Complete                         │
│    - App bug detected? → /code with fix details ──┐     │
│    - Inconclusive? → escalate to user             │     │
└───────────────────────────────────────────────────│─────┘
                          │                         │
                          │    ┌────────────────────┘
                          │    │ (loop back to implement)
                          │    ▼
                          │  Step 3 → 4 → 5 → 6
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 7. COMPLETE                                             │
│    - Report summary to user (code + tests)              │
└─────────────────────────────────────────────────────────┘
```

### Orchestrator Boundaries

The orchestrator delegates, it doesn't implement:
- `/plan` creates feature files
- `/test-review` validates pyramid placement before implementation
- `/code` writes code and runs tests
- `/review` checks quality
- `/e2e` generates and verifies E2E tests

The orchestrator reads only feature files and planning docs, not source code.

## Role Hierarchy

```
ORCHESTRATOR (main thread)
│
├── /plan  ──────► (self-contained skill)
│                  - Feature file creation
│                  - Acceptance criteria
│
├── /test-review ► TEST-REVIEWER AGENT
│                  - Pyramid placement validation
│                  - Spec review decision tree
│                  - Runs before implementation
│
├── /code  ──────► CODER AGENT
│                  - Implementation work
│                  - TDD workflow
│                  - Test execution
│
├── /review ─────► UNCLE-BOB + CUPID + TEST-REVIEWER
│                  - Quality gate (parallel review)
│                  - SOLID violations
│                  - CUPID properties
│                  - Test pyramid placement
│                  - Clean code inspection
│
├── /e2e  ───────► E2E WORKFLOW (coordinates agents)
│                  ├── playwright-test-planner
│                  │   - Explore live app
│                  │   - Create test plans
│                  ├── playwright-test-generator
│                  │   - Generate Playwright tests
│                  ├── playwright-test-healer
│                  │   - Fix failing tests
│                  └── test-reviewer
│                      - Review test quality
│
└── /sherpa ─────► REPO-SHERPA
                   - Documentation
                   - DX improvements
                   - Meta-layer ownership
```

## Meta-Layer Ownership

The **repo-sherpa** agent owns the "meta-layer":
- Repository structure and organization
- Agent and skill definitions (`.claude/agents/`, `.claude/skills/`)
- Documentation (`README`, `CLAUDE.md`, `AGENTS.md`, `docs/`)
- Developer experience and workflows

When changes touch these areas, invoke `/sherpa` for guidance.

## Quick Reference

| Command | Agent | Purpose |
|---------|-------|---------|
| `/orchestrate <req>` | (orchestrator mode) | Enter orchestration mode with requirements |
| `/implement #123` | (orchestrator mode) | Fetch issue → invoke `/orchestrate` |
| `/plan <feature>` | Plan (built-in) | Create feature file (required before /code) |
| `/test-review <path>` | test-reviewer | Review specs and tests for pyramid placement |
| `/code <task>` | coder | Implement with TDD |
| `/review <focus>` | uncle-bob + cupid + test-reviewer | Quality review (parallel) |
| `/e2e <feature>` | (coordinates e2e agents) | Generate and verify E2E tests |
| `/sherpa <question>` | repo-sherpa | Docs/DX/meta-layer |

## Token-Conscious Principle

Agents inherit Claude's knowledge of standard practices (SOLID, Clean Code, TDD). Agent definitions only include:
- Project-specific context
- File references to project standards
- Behavioral overrides (tone, output format)
