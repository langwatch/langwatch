# Part 3 — The advisor in the hooks

**Status:** design input. No ADR, no spec yet.
**Part of:** [agent-usage-advisor-ideation.md](agent-usage-advisor-ideation.md) ·
[Part 1 trace fidelity](agent-usage-01-trace-fidelity.md) ·
[Part 2 signals and surfacing](agent-usage-02-signals-and-surfacing.md)

Parts 1 and 2 make the product able to say something true. This part is about
saying it **to the agent, while it is still spending**, and — when asked to —
stopping it.

The case for doing this in the hooks rather than a dashboard is one number from
the month: spend is nearly flat across all 24 hours, with roughly **35% landing
between midnight and 08:00 UTC**. A recommendation that waits for a human to open
a page misses a third of the problem.

> **A note on paths.** The inventory behind this document was read on the
> `platform/app/**` layout. On `feat/strict-feature-layout-v0` the same code
> lives under `modules/coding-agent/**`. The facts hold; the paths need
> translating.

---

## 1. What exists today

| harness | hooks installed | reaches the model? |
|---|---|---|
| Claude Code (plugin) | `SessionStart` → session-context + session-guidance; `Stop` → session-context | **yes** — `session-guidance` writes `hookSpecificOutput.additionalContext` |
| Claude Code (raw settings fallback) | same two events | yes, same payload |
| Codex | same two events into `~/.codex/hooks.json`, plus a post-turn `notify` | **no** — codex hook output never reaches the model; guidance is a static `AGENTS.md` block |
| opencode | plugin maps `session.created`/`session.idle` | **no** |
| Copilot, Gemini, Cursor | none | — |

Three properties matter and all three are deliberate:

1. **Only `SessionStart` can talk to the model, and it says one constant thing.**
   `SESSION_CONTEXT_GUIDANCE` is a fixed sentence about declaring working
   context. Its own docblock already frames the channel correctly: *"Written to
   the agent, not the user: it is injected into the session's own context, and
   the agent is the one who has to act on it mid-session."*
2. **No hook ever blocks.** The hook code is explicit — nothing on stdout, always
   exit zero. There is no `permissionDecision` and no `exit(2)` anywhere in hook
   code. Only `SessionStart` and `Stop` are registered; there is no
   `PreToolUse`, `PostToolUse`, `UserPromptSubmit` or `PreCompact`.
3. **The hook is already disciplined about latency and failure.** stdin deadline
   2s and capped at 64 KiB; POST timeout 3s via AbortController; the agent kills
   the hook at 10s; per-session fingerprint dedupe; an offline spool capped at 1
   hour and 50 entries; a 10-minute heal throttle.

That third property is the reason this is buildable: the hard part — being fast,
idempotent and offline-tolerant inside someone's editor loop — is already solved
and shipping.

## 2. A refusal mechanism already exists, at the wrong moment

Before it execs the tool, the wrapper probes `GET /api/auth/cli/budget/status`.
On **402** it renders a box and **exits 2 — the agent never starts**. On 404, 5xx
or a network error it passes through. Budgets are already created with
`--on-breach block|warn`.

So the product already knows how to refuse, already has the vocabulary for
warn-versus-block, and already fails open. What it cannot do is act **after** the
session has started — which is the only moment that matters, because the sessions
that cost money are the ones that run for days.

Nothing needs inventing here. It needs moving.

## 3. Three capabilities, in order of intrusiveness

### 3.1 The brief — replace the constant with something computed

Smallest change, highest leverage, and the wire already exists.

At session start the agent reads a short brief about *this repository and this
person's recent sessions*:

> Your last five sessions in this repository averaged a 380:1 carry ratio, and
> two passed 450k context without compacting. The most expensive thing you do
> here is edit files through the shell — 17% of commands last week — which costs
> more and fails 5.3% of the time against 0% for the edit tool. Checkpoint at
> 200k and write a handoff rather than continuing.

Design constraints, all of them hard:

- **Budget it in tokens and report its own cost.** The brief lands in the prefix,
  so it is re-read on every turn at the carry ratio. An advisor that bloats the
  context it exists to shrink is a self-refuting product. Cap it — on the order
  of 120 words — and publish what it costs.
- **Only assert measured facts.** One wrong number and people uninstall the
  plugin.
- **Fail open to the current constant.** Any timeout, any error, any offline —
  the session starts with today's sentence and no delay.
- **Serve it precomputed.** The brief changes per repository per day, not per
  session. Compute it server-side from Part 2's aggregates; the hook does one GET
  inside its 3s budget.

The engineering catch is real and worth naming: `session-guidance-entry.ts`
imports nothing but the constant *by design*, which is what makes it instant.
Computing per-session means reading the hook stdin payload and resolving config
and endpoint — the machinery the context hook already has. Keep the two entries
separate so a slow brief can never delay the attribution the context hook exists
to send.

### 3.1b The same hook should measure the instruction surface

`SessionStart` already knows the working directory. While it is there, it can
`stat` what the session is about to pay for on every turn and report **sizes and
counts, never contents**:

```
claudeMdBytes, skillCount, skillIndexBytes,
mcpServerCount, mcpToolCount, settingsBytes, memoryFileBytes
```

Seven integers, one per session, no runtime cost, and no prompt text ever leaves
the machine. It is the only way to decompose the ~70k-token static prefix that
Part 2 §4b measures, because the product never captures the prompt itself — and
on this repository it would immediately have reported that `CLAUDE.md` is 112 KB,
roughly 28,000 tokens, about **40% of everything re-read on every turn**.

This pairs with the brief: the same session that is told its carry ratio can be
told what its own instruction file costs.

### 3.2 The nudge — mid-session, and this is where "you could enable this" lives

Requires registering events that are not registered today. Ranked by value
against intrusiveness:

| event | what it can say | risk |
|---|---|---|
| `PreCompact` | *"You are about to compact at 256k. Write a handoff and end the lane instead."* | almost none — fires rarely, at exactly the right moment |
| `UserPromptSubmit` | *"This session has spent $310 over 31 hours and is carrying 480k."* | one injection per turn; must be tiny and deduped |
| `PostToolUse` | *"That was a `sed -i`. The edit tool is cheaper, safer and is what the line-count telemetry sees."* | highest frequency, highest latency and noise risk; gate hard |

`PreCompact` deserves singling out. Compaction is the moment a session decides to
carry on rather than stop, and on this account **every compaction observed was
manual** — a person hitting `/compact`, late, at 178k–256k. That is a decision
point with no advice attached to it today.

The "you could enable this" class is mostly `PostToolUse` and the brief, and it
is the most actionable family in the whole design because each item is a
one-line config change with a measured saving:

- **a tool allowlist** — deletes the classifier tax, which was 10% of the most
  expensive turn observed;
- **the edit tool over shell mutation** — cheaper, 5.3% → 0% failure, and it is
  what `linesAdded`/`filesTouched` can actually see;
- **narrower defaults for wide commands**;
- **turning a repeated manual sequence into a skill** — and, from Part 2,
  skills fire on only 0.46% of tool calls, so the opposite recommendation
  ("you have a skill for this and did not use it") belongs here too.

Claude Code already ships a `/fewer-permission-prompts` skill. Where a remedy
already has a tool, the nudge should name it rather than re-explain it.

### 3.3 The stop — refusing the big spend

Two places, and they are complements rather than alternatives.

**In the hook (`PreToolUse` deny).** Precise, immediate, and Claude Code only.
Gives a readable refusal at a tool boundary.

**In the gateway.** Already in the request path, already holds virtual keys and
budgets with `--on-breach block|warn`, already sees a request before it is
billed. It can refuse or downgrade the model call itself, and it is
**harness-independent** — which matters a great deal given §1, where three
harnesses have no model channel at all and two have no hooks.

The split that follows: **advice degrades per harness; enforcement should not.**
Put advice in the hooks and enforcement in the gateway.

What to stop on, taken from the month rather than from taste:

- **cumulative session spend** — a $250 line fires on 8.3% of sessions holding
  70.6% of spend, with $17,530 accruing past it;
- **session lifetime** — sessions over three days are 4.2% of sessions and 51.5%
  of spend;
- **burn rate per hour**, for the unattended case.

Not peak context on its own. The month's most expensive session peaked early,
compacted, and then spent $11,000 sitting flat — a context alarm fires once and
goes quiet.

**Safety rules, and these are not negotiable.** A guardrail that kills a session
mid-slice costs more than the tokens it saved, and will get switched off.

- Warn at half the line; warn and require an explicit continue at the line; hard
  stop only when configured.
- Land a stop **between turns, never mid-tool** — a half-applied edit is worse
  than the spend.
- Keep the existing fail-open posture: unreachable control plane means the work
  continues.
- Default `warn`. `block` is opt-in, and reuses the `--on-breach` vocabulary that
  already exists rather than inventing a second one.

## 4. Cross-harness honesty

A computed brief is impossible on Codex today — there is no per-session channel
to the model, only a static `AGENTS.md` block written at install. The options are
to rewrite that block periodically, which is coarse and stale by construction, or
to accept that Codex gets enforcement through the gateway and no in-session
advice. opencode has hooks but no model channel. Copilot, Gemini and Cursor have
neither.

State this limit rather than letting someone discover it: **in-session advice is
a Claude Code capability first**, and everything else arrives through the
gateway.

## 5. Risks

- **The advisor bloats the context it exists to shrink.** Budget it, measure it,
  publish its cost.
- **Latency in someone's editor loop.** Fail open on every path; never hold a
  session start.
- **Nagging.** Dedupe per session using the fingerprint machinery that already
  exists; cap nudges per session; a nudge worth $3 should never fire.
- **A wrong number destroys trust in one shot.** This depends entirely on Part 1
  — rates instead of a binary error, `success` typed correctly, error codes
  instead of parsed prose.
- **Guardrails that block real work get disabled**, taking the advice with them.
  Warn-first is not timidity; it is what keeps the channel installed.

## 6. Done when

- The `SessionStart` brief is computed per repository and per person, capped,
  measured, and falls back to today's constant on any failure.
- `PreCompact` carries a handoff recommendation.
- At least one "you could enable this" remedy — the tool allowlist is the
  obvious first — is delivered in-session and its saving is verified afterwards
  by Part 2's verification pass.
- A cumulative session-spend policy exists with warn and block modes, enforced in
  the gateway, landing only between turns, failing open.
- The advisor's own token and dollar cost is visible in the product.
