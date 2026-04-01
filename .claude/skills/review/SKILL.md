---
name: review
description: "Run parallel code reviews: principles-reviewer (SRP/design), hygiene-reviewer (reuse/patterns/idioms), test-reviewer (pyramid/coverage), and security-reviewer (PII/secrets). Surfaces conflicts for human decision."
context: fork
user-invocable: true
argument-hint: "[focus-area or file-path]"
---

Run reviewers in parallel on the recent changes.

## Step 0: Create Tasks

Use the TaskCreate tool to create a task for each step below. Mark each `in_progress` when starting and `completed` when done.

1. Pre-fetch diff and detect language
2. Principles review (SRP, readability, simplicity, extensibility)
3. Hygiene review (reuse, patterns, idioms, dead code, bloat)
4. Security review (PII, secrets, data exposure)
5. Test review (pyramid, coverage, naming) — conditional
6. Persona perspectives (Uncle Bob, Metz & Beck, Fowler)
7. Synthesize and surface conflicts

## Step 1: Pre-fetch context

Fetch the diff once. All agents receive it — no agent should fetch independently.

```bash
# Detect default branch
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

# Get the diff
DIFF=$(git diff "origin/$DEFAULT_BRANCH"...HEAD)

# Detect primary language
LANG=$(git diff "origin/$DEFAULT_BRANCH"...HEAD --stat | grep -oE '\.\w+$' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')

# Check if tests are in the diff
HAS_TESTS=$(echo "$DIFF" | grep -cE '^\+.*\b(test|spec|__tests__|describe|it\(|#\[test\])' || true)
```

Pass `$DIFF` and `$LANG` as context to every agent prompt.

## Step 2: Launch reviewers

Spawn agents in a **single message** so they run concurrently. Each agent gets the diff in its prompt — they must NOT fetch it themselves.

**Always spawn:**
1. **principles-reviewer** (`subagent_type: "principles-reviewer"`) — SRP, readability, simplicity, extensibility
2. **hygiene-reviewer** (`subagent_type: "hygiene-reviewer"`) — reuse, patterns, idioms, dead code, bloat
3. **security-reviewer** (`subagent_type: "security-reviewer"`) — PII, secrets, data exposure

**Conditionally spawn:**
4. **test-reviewer** (`subagent_type: "test-reviewer"`) — only if `$HAS_TESTS > 0` OR the diff adds functionality without any test files

Include in each agent's prompt:
- The full diff
- The detected primary language
- The focus area from `$ARGUMENTS` (if any)
- Instruction: "Do NOT run git diff yourself. Review the diff provided below."

Focus area: $ARGUMENTS

## Step 3: Persona Perspectives

After all reviewers return, spawn **3 agents in a single message** using `subagent_type: "devils-advocate"` with `model: opus`. Each gets the diff AND the reviewer findings from Step 2. CUPID is already covered by the principles-reviewer checklist — no persona needed.

1. **Uncle Bob** — "You are Robert C. Martin reviewing this code. Focus on SOLID violations, especially SRP. Are there classes with multiple responsibilities? Functions that do more than one thing? Dependencies pointing the wrong way? Be direct and uncompromising."

2. **Sandi Metz & Kent Beck** — "You are Sandi Metz and Kent Beck reviewing this code together. Is this the simplest thing that could possibly work? Is there premature abstraction — would duplication be better than the wrong abstraction? Are the objects small enough? Are the messages clear? Does the code communicate its intent? Prefer simple over clever, always."

3. **Martin Fowler** — "You are Martin Fowler reviewing this code. Look for refactoring signals and code smells: feature envy, shotgun surgery, long parameter lists, primitive obsession, data clumps. Is there a deeper design problem hiding behind this diff? Are the coupling patterns healthy? Would you reach for Extract Method, Move Method, or Replace Conditional with Polymorphism here?"

Each persona should give a **brief, opinionated take** (3-5 bullet points max). Not a full review — a sharp perspective on what the checklist reviewers might have missed or underweighted.

## Step 4: Synthesize

After all agents return (checklist reviewers + personas):

```
## Review Summary

### Design (Principles)
[Key findings on SRP, readability, extensibility]

### Codebase Fit (Hygiene)
[Key findings on reuse, patterns, idioms, dead code]

### Tests
[Key findings — or "Skipped: no test-relevant changes" if test-reviewer wasn't spawned]

### Security
[Key findings on PII/secrets]

### Persona Perspectives
**Uncle Bob**: [sharp take on SOLID]
**Metz & Beck**: [sharp take on simplicity/abstraction/communication]
**Fowler**: [sharp take on refactoring signals/code smells]

### Conflicts Requiring Decision
[Any tensions between reviewers or personas — these need human input]

### Agreed Improvements
[Recommendations multiple reviewers support]
```

## Step 5: Surface Conflicts

If reviewers or personas disagree (e.g., principles says "extract this" but hygiene says "the existing pattern keeps it together", or Sandi says "this abstraction is premature" but Uncle Bob says "this violates OCP"):
- State all positions
- Explain the tradeoff
- Mark as **NEEDS USER DECISION**

## Step 6: Pattern Scan

If any reviewer flags a pattern that could exist elsewhere, search the codebase for similar occurrences using Grep. Report any matches found.
