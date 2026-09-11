# Part 1 — Make coding-agent traces correct

**Status:** design input. No ADR, no spec yet.
**Part of:** [agent-usage-advisor-ideation.md](agent-usage-advisor-ideation.md) ·
Part 2 is surfacing, Part 3 is the CLI hook.

Nothing in Parts 2 and 3 is trustworthy until this is done. Every signal, every
roll-up and every in-session warning reads these rows.

---

## 1. A coding-agent turn is not pass or fail

A coding-agent trace is **one user-prompt turn**. Inside it are tens to hundreds
of tool executions and model calls. Marking the whole turn `error` because one
of them failed is a category error, and the data shows exactly how badly it
misleads.

Over 31 days and 16,980 turns on one account:

| | turns | median duration | median output | median cache-read | share of spend |
|---|---:|---:|---:|---:|---:|
| marked `error` | 1,875 (11%) | 528s | 37,950 | 12.35M | **64.6%** |
| clean | 15,105 (89%) | 4s | 77 | 0.21M | 35.4% |

That looks like "errors cost us two thirds of the bill". It is not. The error
flag is **confounded with turn length**: a multi-minute agentic turn almost
always contains at least one failing command somewhere in it, so the flag marks
*substantive work*, not failure. A turn that ran 300 tool calls with two
failures is flagged identically to one that died on its first call.

Consequences today:

- the sessions and traces lists paint a red state on the most productive turns;
- anyone filtering to `error` gets "the expensive turns", which is why the
  number looked so dramatic;
- **any signal built on this field would measure length and call it waste.**

## 2. Replace the flag with rates

The rows needed already exist. `coding_agent_session_events` stores a
`tool_result` row per tool execution carrying `success`, `toolName`,
`toolResultBytes`, `toolInputBytes`, `durationMs`, and a `tool_decision` row
carrying `decision` and `decisionSource`.

Proposed on the trace (and folded onto the session):

| field | definition |
|---|---|
| `toolFailureRate` | failed tool results ÷ tool results |
| `toolDenialRate` | denied decisions ÷ decisions |
| `modelErrorRate` | model calls with a non-2xx status ÷ model calls |
| `aborted` | the turn itself terminated — a real boolean, and rare |
| `failuresByTool` | a small map, because the distribution is not uniform |

Measured on three real sessions:

| session | tool results | failed | failure rate | denials |
|---|---:|---:|---:|---:|
| `0a5117b3` | 638 | 16 | 2.5% | 0 |
| `b20f71f1` | 6,046 | 261 | 4.3% | 22 |
| `fda27b80` | 243 | 2 | 0.8% | 0 |

And the distribution is emphatically not uniform — **the entire error story is
the shell**:

| tool | calls | failed | failure rate |
|---|---:|---:|---:|
| Bash | 5,220 | 278 | **5.3%** |
| Read | 424 | 1 | 0.2% |
| Edit | 845 | 0 | 0.0% |
| Write | 198 | 0 | 0.0% |
| Agent | 75 | 0 | 0.0% |
| Skill | 32 | 0 | 0.0% |

"5.3% of this session's shell commands failed" is a sentence a person can act
on. A red dot is not.

## 3. `success` is a string, and every consumer of it is silently wrong

On all 6,927 `tool_result` rows inspected, `success` has JavaScript type
**`string`** — the values are `"true"` (6,648) and `"false"` (279), never
booleans.

```js
if (row.success) { /* taken for "false" too */ }
```

Both string values are truthy, so any truthiness check passes always. This is
not theoretical: it produced a wrong answer inside this very analysis — the
first pass computed a 4.3% failure rate with an explicit string comparison, the
second pass used `=== false`, reported **0.0% for every tool**, and looked
entirely plausible.

**The span is right and the row is wrong**, which locates the bug precisely. The
tool span's own output carries a real boolean:

```json
{"status":"completed","success":true,"durationMs":665,
 "resultSizeBytes":201,"decision":"accept","decisionSource":"config"}
```

The type is lost on the way into the event row. Fix it at the projection, and
audit every reader of a lifted scalar for the same class. The lifted-key vocabulary carries many attributes that are
conceptually boolean or numeric (`success`, `is_fork`, `attempt`,
`tool_result_size_bytes`); anything arriving from OTel attributes should be
coerced once, at the seam, not trusted at each call site.

## 4. Declared events that never arrive

Each of these is a canonical event or field that is wired and empty. Each is a
bug to close before it is a feature to build on.

| what | expected | observed |
|---|---|---|
| `rate_limit` | canonical event, two wire aliases, its own stored row kind | **zero rows** across 8,614 model calls; the month's 89 real rate limits appear only as trace error prose with null cost |
| `ttft_ms` | per-call time to first token | **0 on 7,718 of 7,718** — a placeholder, not a measurement |
| `statusCode` / `errorType` | per model call | empty on every model-call row observed |
| `stopReason` | why generation stopped | empty |
| `totalTokens` | per call | 0 |
| context-window exhaustion | a first-class condition | arrives as the prose `prompt is too long: 1,000,497 tokens > 1,000,000` |

## 5. Errors need codes, not prose

Classifying the month's failures required regular expressions over message
strings. The taxonomy that fell out, with counts:

| code | count |
|---|---:|
| `shell_command_failed` | 1,064 |
| `local_guard_refusal` | 614 |
| `rate_limited` | 89 |
| `subagent_limit_reached` | 38 |
| `provider_overloaded` | 36 |
| `context_window_exceeded` | 3 |
| `tool_result_too_large` | 2 |

Two of these deserve attention on their own. **614 local guard refusals** are
turns where our own tooling refused the agent — a self-inflicted cost centre
that nobody is counting. This is not hypothetical: the worktree guard blocked
every `git` invocation in the session that produced this document, because a
shell hook rewrote `git` into `rtk git` and the guard could no longer prove which
directory it would run in.

## 6. Model the two populations rather than inferring them

The trace population is sharply bimodal:

| | traces | median duration | median output | median cost | share of spend |
|---|---:|---:|---:|---:|---:|
| heavy (>60s or >5k output) | 3,318 | — | — | — | **92.6%** |
| light | 13,662 | 4s | 77 tokens | $0.07 | 7.4% |

Four fifths of what the product calls a trace is a sub-agent call, a permission
classifier or a one-line reply. The month reduces to **2,013 heavy Opus turns
costing $19,811**, 62% of the total.

Classify this at ingest — main-agent turn versus auxiliary call — using the
`query_source` / `agent_type` / `parent_agent_id` scalars already lifted. Without
it every mean is computed over the wrong denominator and every list shows noise
at 80% density.

## 7. Command text lives only on spans, and Part 2 needs it

The `tool_result` row carries `toolInputBytes` — the *size* of the tool input,
never its content. The command itself sits on the tool span:

```json
{"command": "sed -i '' 's/foo/bar/' src/thing.ts",
 "description": "Rename the symbol"}
```

Several of the most valuable behavioural signals in Part 2 need that string, not
its length — telling `sed -i` apart from `ls` is the whole point. Two options,
and the choice belongs in this part rather than being discovered in the next:

- lift a small, bounded classification at ingest (tool verb, whether the command
  mutates a file, whether it is a whole-tree operation) onto the event row, so a
  signal never has to read spans; or
- accept that this family of signals reads the span store, and bound that read
  deliberately.

The first is cheaper to query and keeps content out of a second place. It also
sidesteps the privacy question, since a classification is not the command.

## 8. Two things that are stored but never folded

- **Per-subagent cost.** `parentSessionId` and `isFork` are stored; `depth`,
  `spawn_mode` and `parent_agent_id` are lifted and never folded; there are no
  per-subagent tokens, cost or duration. The shape of a fleet is known and its
  cost is not.
- **The per-call context series.** The events table carries working context per
  row, but the fold keeps only `peakContextTokens` and compaction before/after.
  The growth curves in the ideation exist only because the browser rebuilds them
  on drawer open.

## 9. Codex and the other harnesses

Codex produces no `model_call` rows, no cost metric and no lines-of-code. Gemini
and Copilot have agent definitions but the wire vocabulary is Claude-centric.
Anything Parts 2 and 3 ship is effectively Claude Code only until this is
levelled, and that limit should be stated rather than discovered.

---

## Done when

- A coding-agent trace reports rates and a real `aborted` boolean; the red error
  state is reserved for turns that actually died.
- `success` and every other lifted scalar is typed once at the seam, and no
  consumer branches on a stringly-typed boolean.
- Every error carries a code from a closed list; message prose is never parsed.
- `rate_limit` rows appear when a session is rate limited, and `ttft_ms` either
  measures something or is removed.
- A trace is classified heavy-turn or auxiliary-call at ingest.
- The context series and per-subagent cost are folded, not reconstructed.
