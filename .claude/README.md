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
     │                                           │
     │ /code                                     │ /browser-test
     ▼                                           ▼
┌──────────────────┐              ┌──────────────────────────┐
│  CODER AGENT     │              │  BROWSER VERIFICATION    │
│  (context: fork) │              │  (interactive)           │
│  - TDD workflow  │              │  - Drives real browser   │
│  - Returns       │              │  - Screenshots + report  │
│    summary       │              │  - No test files         │
│                  │              │                          │
└──────────────────┘              └──────────────────────────┘
```

## Directory Structure

```
.claude/
├── agents/         # Agent definitions (personas with workflows)
│   ├── coder.md
│   ├── devils-advocate.md            # Stress-test proposals and plans
│   ├── playwright-test-planner.md    # Ad-hoc: explores app, creates plans
│   ├── playwright-test-generator.md  # Ad-hoc: generates tests from plans
│   └── playwright-test-healer.md     # Ad-hoc: fixes failing tests
├── skills/         # Skills (entry points that invoke agents)
│   ├── code/           # Delegates to coder agent
│   ├── challenge/      # Delegates to devils-advocate
│   ├── drive-pr/       # Fix CI failures + address review comments
│   └── browser-test/   # Interactive browser verification
└── commands/       # Slash commands (non-agent utilities)
```

## Concepts

### Agents (.claude/agents/)

Agents are **specialized personas** with defined workflows and expertise. They run in isolated context forks and return structured summaries.

| Agent | Purpose | Model |
|-------|---------|-------|
| `coder` | TDD implementation, self-verification | Opus |
| `devils-advocate` | Stress-test proposals, plans, and architecture decisions | Opus |
| `playwright-test-planner` | Explore live app, create test plans (ad-hoc) | Opus |
| `playwright-test-generator` | Generate Playwright tests from plans (ad-hoc) | Sonnet |
| `playwright-test-healer` | Debug and fix failing tests (ad-hoc) | Sonnet |

Agents are invoked **only through skills**, never directly.

### Skills (.claude/skills/)

Skills are **entry points** that:
1. Accept user commands (`/code`, `/challenge`)
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

## Quick Reference

| Command | Agent | Purpose |
|---------|-------|---------|
| `/code <task>` | coder | Implement with TDD |
| `/challenge <proposal>` | devils-advocate | Stress-test proposals and plans |
| `/browser-test [port] [feature]` | (interactive verification) | Verify feature works in real browser |

## Token-Conscious Principle

Agents inherit Claude's knowledge of standard practices (SOLID, Clean Code, TDD). Agent definitions only include:
- Project-specific context
- File references to project standards
- Behavioral overrides (tone, output format)
