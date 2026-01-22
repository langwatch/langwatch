# Claude Code Orchestration System

This document explains how Claude Code agents and skills work together in this repository.

## Architecture Overview

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN THREAD (Orchestrator)                                         │
│  - Holds requirements in TodoWrite                                  │
│  - Delegates code work to agents                                    │
│  - Verifies outcomes                                                │
│  - Does NOT read/write code directly                                │
└─────────────────────────────────────────────────────────────────────┘
     │                                     │
     │ Skill(skill: "code")                │ Skill(skill: "review")
     ▼                                     ▼
┌────────────────────────┐       ┌────────────────────────┐
│  CODER AGENT           │       │  UNCLE-BOB-REVIEWER    │
│  (context: fork)       │       │  (context: fork)       │
│  - Reads requirements  │       │  - Reviews changes     │
│  - Implements with TDD │       │  - SOLID/TDD checks    │
│  - Runs tests          │       │  - Returns findings    │
│  - Returns summary     │       │                        │
└────────────────────────┘       └────────────────────────┘
```

## Directory Structure

```
.claude/
├── agents/         # Agent definitions (personas with workflows)
│   ├── coder.md
│   ├── repo-sherpa.md
│   └── uncle-bob-reviewer.md
├── skills/         # Skills (entry points that invoke agents)
│   ├── orchestrator/   # Auto-activates on implementation requests
│   ├── implement/      # Manual: /implement #123
│   ├── code/           # Delegates to coder agent
│   ├── review/         # Delegates to uncle-bob-reviewer
│   └── sherpa/         # Delegates to repo-sherpa
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

Agents are invoked **only through skills**, never directly.

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

### Activation

1. **Automatic**: User says "implement", "fix", "add feature" → `orchestrator` skill activates
2. **Manual**: User runs `/implement #123` → `implement` skill activates

### The Loop

```
┌─────────────────────────────────────────────────────────┐
│ 1. CAPTURE REQUIREMENTS                                 │
│    - Fetch GitHub issue (gh issue view)                 │
│    - Read feature file (specs/features/*.feature)       │
│    - Extract acceptance criteria → TodoWrite            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 2. IMPLEMENT                                            │
│    Skill(skill: "code", args: "feature file + task")    │
│    Coder implements, runs tests, returns summary        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 3. VERIFY CODER OUTPUT                                  │
│    Check summary against todo criteria                  │
│    - Missing? → /code again with feedback               │
│    - All met? → Continue                                │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 4. REVIEW (Mandatory)                                   │
│    Skill(skill: "review", args: "review recent changes")│
│    Uncle Bob reviews for SOLID, TDD, clean code         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 5. VERIFY REVIEW                                        │
│    - Issues found? → /code with reviewer feedback       │
│    - Approved? → Mark todo complete                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 6. COMPLETE                                             │
│    - Report summary to user                             │
│    - Max 3 iterations per task (escalate if failing)    │
└─────────────────────────────────────────────────────────┘
```

### Orchestrator Rules

The main thread as orchestrator:
- **DOES**: Hold requirements, delegate work, verify outcomes
- **DOES NOT**: Read source code, write code, run tests directly

## Role Hierarchy

```
ORCHESTRATOR (main thread)
│
├── /code  ──────► CODER AGENT
│                  - Implementation work
│                  - TDD workflow
│                  - Test execution
│
├── /review ─────► UNCLE-BOB-REVIEWER
│                  - Quality gate
│                  - SOLID violations
│                  - Clean code inspection
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

| Command | Triggers | Agent | Purpose |
|---------|----------|-------|---------|
| `/implement #123` | Manual | (orchestrator mode) | Start implementation workflow |
| `/plan <feature>` | Manual/Orchestrator | Plan (built-in) | Create feature file (required before /code) |
| `/code <task>` | Manual/Orchestrator | coder | Implement with TDD |
| `/review <focus>` | Manual/Orchestrator | uncle-bob-reviewer | Quality review |
| `/sherpa <question>` | Manual | repo-sherpa | Docs/DX/meta-layer |

## Token-Conscious Principle

Agents inherit Claude's knowledge of standard practices (SOLID, Clean Code, TDD). Agent definitions only include:
- Project-specific context
- File references to project standards
- Behavioral overrides (tone, output format)
