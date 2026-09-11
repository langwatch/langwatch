# Part 2 — Show what went wrong, and what to improve

**Status:** design input. No ADR, no spec yet.
**Part of:** [agent-usage-advisor-ideation.md](agent-usage-advisor-ideation.md) ·
[Part 1 is trace fidelity](agent-usage-01-trace-fidelity.md) · Part 3 is the CLI hook.

Two surfaces, one signal library: **on the trace and session**, what happened in
this particular piece of work; **over history**, whether it is getting better.

---

## 1. There is already a signal engine, and it runs in a drawer

`modules/coding-agent/web/src/trace/session-signals.ts` computes twelve named
signals per session — truncated, rate-limited, retries-exhausted, retry time over
10s, cache churn over 25%, compacted, blocked-on-user over 60s, tools denied,
hooks blocked, failed tools, refusals, permission changed. `context-health.ts`
bands context against the window and `token-timeline.ts` reconstructs the growth
curve.

All of it runs in the browser, on drawer open, for one session at a time. Nothing
is persisted, nothing is priced, nothing carries a remedy, and nobody sees it
unless they already suspected that session.

The work is not inventing signals. It is **moving these server-side, pricing
each one, giving it a remedy, running it across sessions, and putting the result
where someone will see it.**

## 2. The signal library, revised by a month of data

Ordered by what the month showed actually matters, which is not the order the
first pass guessed.

### A. `spend.*` — new, and it leads

The strongest predictors are the least clever ones.

| signal | detects | remedy |
|---|---|---|
| `spend.session_threshold` | cumulative session spend crosses a line | stop, checkpoint, restart |
| `spend.burn_rate` | dollars per hour, sustained | the session is running unattended |
| `spend.session_lifetime` | a session still alive after N days | end it |

Why it leads: sessions running **over three days are 4.2% of the population and
51.5% of spend**. A flat $250 cumulative threshold fires on 8.3% of sessions,
which hold 70.6% of spend, and **$17,530 of one month accrued after those
sessions crossed it**. No modelling, no inference, no new capture.

### B. `context.*` — demoted, not dropped

`context.unbounded_growth`, `context.carry_ratio_high`, `context.late_compaction`,
`context.idle_hold`, `context.instruction_overhead` all stand. But growth alone is
not the alarm it looked like: the month's single most expensive session peaked at
985.8k on day three, fell back to ~560k after compaction, and then spent another
$11,000 over eleven days sitting flat. A growth alarm fires once and goes quiet.

Peak context is better used as a **cohort marker** than a trigger — sessions
peaking above 900k are seven of 240 and hold 46.1% of spend; those under 300k are
124 sessions and 4.3%.

`context.idle_hold` now has a price: a turn following a gap of over an hour
writes a mean of **298.7k** cache tokens against **25.7k** for a turn under a
minute behind the last — an 11.6× rebuild.

### C. `routing.*`

`routing.premium_on_mechanical`, `routing.classifier_tax`, `routing.fleet_cost`
stand as written. The classifier tax remains the sharpest single example: 61
Sonnet permission-classifier calls inside one $19.44 turn cost $1.92 — 10% of the
turn — at a 5,689:1 carry ratio, to answer yes-or-no questions.

### D. `behaviour.*` — how the agent does the work

This is where the month and the span data added most.

| signal | detects | evidence |
|---|---|---|
| `behaviour.shell_mutation` | files edited through the shell instead of the edit tool | §3 below |
| `behaviour.shell_dominance` | the shell as a share of all tool calls | Bash is **10,463 of ~13,900** tool calls (75%) |
| `behaviour.failure_concentration` | one tool failing far more than the rest | Bash 5.3%, every other tool ~0% |
| `tool.wide_output` | a tool result large enough to matter once carried | see the caution below |

**A correction on `tool.wide_output`.** It is real but much smaller than the
first pass implied. Across 6,927 tool results: median 385 bytes, p90 4.1KB, p99
14.9KB, max 51.6KB — **10.9MB total, roughly 2.7M tokens**. Results above 20KB
are 0.3% of calls carrying 5.7% of bytes. Tool output is not what fills these
contexts. Keep the signal, drop it down the ranking, and describe it honestly.

### E. `loop.*` and `orchestration.*`

Unchanged from the ideation: cadence clustering, repeated identical commands,
no-progress ticks, concurrency versus rework, resume depth.

### F. `outcome.*`

`outcome.cost_per_landed_change` remains the only fair ranking and the biggest
gap. §3 explains why it is currently unmeasurable for a meaningful share of work.

### G. `skills.*` — new, §4

---

## 3. Editing through the shell is not just a bad habit — it blinds the product

Sampling the tool spans of one heavy trace: **22 of 132 commands (16.7%) mutate
files through the shell** — 18 inline or scripted Python, 2 `awk`, 2 `sed -i`.
The Python calls are not one-liners; they run scripts the agent first wrote to a
scratch directory (`resolve_ret.py`, `split_conflict.py`). The agent authored a
program in order to perform an edit.

That is one trace, so treat 16.7% as indicative rather than a rate. The reasons
it matters do not depend on the exact number:

1. **It costs more.** Writing a program to make an edit spends output tokens on
   the program, then a tool call to run it, then usually a read to verify it —
   against one `Edit` call.
2. **It fails more.** Bash fails 5.3% of the time; `Edit` and `Write` fail 0.0%.
   The riskiest path is being chosen for the safest task.
3. **It is unreviewable.** A `sed -i` across a tree produces no per-file diff the
   agent ever sees, which is how silent mass edits happen.
4. **It breaks our own telemetry, which is the part that should worry us.** The
   session fold counts `linesAdded`, `linesRemoved`, `filesTouched`,
   `editsAccepted` and `editsRejected` — all of which are fed by *edit tool*
   telemetry. **A session that does its editing through Python reports almost no
   code changed.** Every outcome metric in family F, including cost per landed
   change, silently under-counts exactly the sessions behaving worst.

So `behaviour.shell_mutation` is two things at once: a recommendation to the user
("use the edit tool — it is cheaper, safer and reviewable") and a **correctness
requirement for the product's own outcome metrics**. Until shell mutations are
detected and counted, cost-per-landed-change is wrong in an unknown direction.

Detection is a classification over the command string, which Part 1 §7 covers:
the command text lives on spans, not on event rows, and a bounded
`mutatesFiles` / `isWholeTreeOperation` classification lifted at ingest keeps
this cheap.

---

## 4. Skills: used well, used badly, or not used at all

### What the data says

Across 23,003 session events in four heavy sessions:

| tool | invocations |
|---|---:|
| Bash | 10,463 |
| Edit | 1,691 |
| Read | 849 |
| Write | 396 |
| Agent | 150 |
| **Skill** | **64** |

**Skills are invoked in roughly 0.46% of tool calls.** Against a repository
carrying on the order of 38,500 words of skill material — material that is
summarised into the system prompt of every single turn, and therefore paid for on
every turn at the carry ratio.

That is the headline skills finding: **the cost of skills is paid continuously
and the benefit is drawn 0.46% of the time.** Whether that ratio is bad depends
on whether the right skill fires at the right moment — which is precisely what
nothing measures today.

### The signals

| signal | detects | needs |
|---|---|---|
| `skills.never_invoked` | a skill exists but has never fired in N days | repo-side skill inventory joined to activation telemetry |
| `skills.context_tax` | the always-loaded share of the prompt attributable to skill descriptions, priced per month | context floor decomposition |
| `skills.should_have_fired` | a prompt matching a skill's declared triggers, where the skill was never invoked | skill trigger text + prompt text |
| `skills.invoked_then_ignored` | skill fires, and the following turns violate what it says | hardest; start with the proxy below |
| `skills.thrash` | the same skill invoked repeatedly within one session | activation rows |
| `skills.oversized` | one skill's material dominating the floor every turn | per-skill token attribution |

`skills.should_have_fired` is the one that answers "not enough". Every skill
already declares its own triggers in its description — that is what the harness
matches on — so the same text can be matched offline against prompts that did not
activate it. A weekly finding reading *"seven prompts this week matched
`module-review`'s triggers and none invoked it"* is concrete and actionable, and
the remedy is usually one sentence in the skill's description rather than
anything in the code.

`skills.invoked_then_ignored` is genuinely hard and should not be over-promised.
A defensible proxy: a skill fires, and within the same session the failure it
exists to prevent occurs anyway — a lint rule it documents trips, a test it
prescribes is never run, a command it forbids is issued. That requires the skill
to declare a checkable postcondition, which most do not. Worth prototyping on one
or two skills before generalising.

### What is missing in capture

Verified against the code, and it is worse than "no per-skill cost":

- **`skill_activated` is not a stored event row.** The row allowlist admits
  `api_request`, `compaction`, `rate_limit_*`, `api_error`, `retries_exhausted`,
  `tool_result`, `tool_decision`, `user_prompt`, `subagent_completed` — and
  nothing else. The enqueue gate declines skill activations before a job is
  minted. `skill_activated` is canonical in the normaliser and the fold only.
- **The aggregate keeps names and nothing else.** Two paths write into it — the
  log event's `skill.name`, and any tool span carrying `skill_name` — both into
  `skills: string[]`, a **bounded set capped at 50 distinct values**, with
  duplicates dropped. No count, no duration, no cost, and silent truncation past
  50.
- **`toolCounts` counts the literal string `Skill`, not which skill ran.** So the
  one place with counts cannot tell `module-review` from `spec-bind`.
- **Slash commands are worse.** `slash_command` normalises into a `user_prompt`
  row, but the row does not carry the command name; only the aggregate's
  `slashCommands` bounded set has it.
- **Plugins have no field at all**, and MCP servers and tools are name sets
  parsed out of `mcp__<server>__<tool>` tool names.
- **Nothing is in a spec.** No scenario covers skill telemetry anywhere.

Today the only surface is the replay drawer's session tab, which lists
"Reached for" — skills, sub-agents, commands, MCP servers and tools, as names.
It is absent from session signals, from the sessions table and from the CLI.

A capped set of names cannot answer a single question in the table above. The
minimum is an **activation row** carrying skill name, time and owning turn, so an
activation can be placed against what happened next — and per-skill counts keyed
by the skill's own slug rather than by the string `Skill`. Slash commands,
plugins and MCP tools want the same treatment, because they are all instruction
surface that is paid for always and drawn on sometimes.

### Not to be confused with

`specs/skills/agent-insight-skills.feature` describes a ladder of three skills
(agent-improve, agent-performance, agent-best-practices) that diagnose **the
customer's production agent**, pull-based, when a human asks. That is a different
product. This is about the coding agent's own use of skills, measured without
anyone asking.

---

## 4b. Prompt composition: what a session pays for before it starts

### We do not capture the prompt, and we do not need to

An `llm_request` span's `input.value` holds **only the latest message** — there
is no message array, no system prompt, no tool definitions. So the prompt cannot
be decomposed by reading what we store. That is the correct privacy posture and
it should stay.

It can be measured indirectly, and quite precisely. **The first measured context
of a session is the static prefix** plus one short user message. Across 236
sessions:

| | first-call context |
|---|---:|
| min | 4,864 |
| p10 | 63,206 |
| **median** | **70,151** |
| p90 | 81,463 |

The tightness of that band — 63k to 81k across every session on the account — is
the signature of a fixed prefix. **Every session starts at roughly 70,000 tokens
before any work happens**, and that floor is re-read on every turn for the life
of the session.

Scale it honestly: 16,980 turns × ~70k ≈ **1.19B tokens**, about **2.8%** of the
month's 42.75B cache reads. Real money, and not the dominant lever — the
dominant lever is still session length. Say so rather than overselling it.

### What the floor is made of, and why only a local measurement can say

The floor decomposes into classes the product knows the *names* of and not the
*sizes* of: harness system prompt, tool definitions, project instructions
(`CLAUDE.md`), the always-loaded skill index, MCP tool schemas, memory files.
The session aggregate carries `skills`, `mcpServers` and `mcpTools` as capped
name sets — so we know what is loaded and nothing about what it costs.

Measured locally on this repository:

| class | on disk | estimated tokens | share of the ~70k floor |
|---|---:|---:|---:|
| `CLAUDE.md` | 112 KB | ~28,000 | **~40%** |
| skill index (15 × frontmatter) | 9.2 KB | ~2,300 | ~3% |
| harness system prompt + tool definitions + MCP | — | remainder | ~57% |

**A single project instructions file is about 40% of what every turn re-reads.**
That is a finding a person can act on in an afternoon, and nothing in the product
could have told them.

### The method: measure sizes locally, never contents

The CLI hook already runs at `SessionStart` and already knows the working
directory. It can `stat` the instruction surface and report **sizes and counts,
never contents** — `CLAUDE.md` bytes, skill count and index bytes, MCP server and
tool counts, settings size. That is a handful of integers per session, costs
nothing at runtime, keeps prompt text out of the product entirely, and turns both
`context.instruction_overhead` and `skills.context_tax` from estimates into
measurements. Part 3 carries the hook change.

### Classifying the request is a different question, and that part is already done

There is already a per-request classification on the span: `llm_request.context`
(observed value `interaction`) alongside `query_source_safe`
(`repl_main_thread`), `query_source` and `agent_type`. Those say **what kind of
call this is** — main thread, sub-agent, classifier, compaction — which is
exactly what Part 1 needs to separate heavy turns from auxiliary calls. It is
lifted onto spans but does not reach trace metadata, so it is unavailable to any
trace-level read today.

So the answer to "is the classification limited by the fields we have" is yes,
and in two different ways: **request class exists and is not plumbed through**;
**prompt-composition class does not exist and needs the local measurement above.**

## 5. On the trace and session: what went wrong here

Replace the red dot (Part 1) with an explanation. For one turn or session:

- **what it cost**, and its carry ratio, against the median for this repository;
- **tool failure rate by tool** — "5.3% of this session's shell commands failed"
  rather than a state icon;
- **the context curve**, with compactions marked and their trigger shown;
- **where the money went** inside the turn: main-agent calls versus auxiliary
  calls, and the classifier tax as its own line;
- **the largest tool results**, since those are carried onward;
- **behaviour notes**: shell mutations, repeated commands, wide sweeps;
- **skills**: which fired, which were available and did not.

Each item is a Finding with a remedy, not a statistic.

## 6. Over history: is it getting better

- **The power-law view.** Sessions ranked by cumulative spend with the threshold
  line drawn across them. This is the single most useful screen implied by the
  whole analysis, and it is a sorted list.
- **Cohorts**: by session lifetime, by peak context, by harness, by model.
- **Weekly trend**: spend, carry ratio, model mix. On this account Opus share
  fell 83.2% → 64.4% and carry ratio 476:1 → 333:1 over three weeks, and nothing
  in the product says so.
- **Per pull request**: the existing report, plus a verdict and ranked savings.
- **Verification**: an applied recommendation, its before and after, and the
  realised saving. A detector whose remedies never move the metric gets retired.

## 7. The Finding object

```
code                      behaviour.shell_mutation
severity                  ranked by money, never by taxonomy
scope                     turn | session | pull request | repository | person | org
evidence                  trace ids, event ids, one quoted command
measured                  tokens, dollars, wall-clock
estimated_recoverable     $/week, and the method used
remedy                    a concrete action
status                    open | applied | dismissed | regressed
```

Findings deduplicate into issues the way an error tracker does — one code plus one
repository is one issue accruing occurrences and dollars, not forty alerts. A
finding worth $3 a week never reaches a human.

## 8. What this part needs from Part 1

- rates instead of a binary error, so "what went wrong" is a number;
- `success` typed correctly, or every failure count is silently zero;
- error codes instead of prose;
- heavy turns separated from auxiliary calls, or every average is noise;
- a `mutatesFiles` classification lifted at ingest;
- an activation row for skills, slash commands and MCP tools;
- per-subagent cost, for `routing.fleet_cost`.
