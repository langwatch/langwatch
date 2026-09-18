# Real Langy asks mined from `project_6FujhzZ3VwRlZl01TE9os`

Provenance for `langy-real-asks.scenario.test.ts`. Pulled 2026-08-14.

Source: `POST https://app.langwatch.ai/api/trace/search`, `Authorization: Basic
base64(projectId:key)`. Note two traps for anyone re-running this: the endpoint is
**POST**, not GET, and `projectId` must **not** appear in the body — scoping is
implicit via the credential. `X-Auth-Token` and `Bearer` are both rejected for an
`sk-lw-` project key. Verified with a bad-key control on the same endpoint (401 vs
200), so the counts below are the project's, not a request that never landed.

One more trap: `input.value` is the **rendered prompt**, not the user's message.
Most traces wrap the real ask after a `THE USER'S MESSAGE:` marker, and some carry
only scaffolding (`THE CONVERSATION SO FAR:`, `WHAT THE USER IS LOOKING AT`,
`USER PR CAP REACHED`). Reading `input.value` raw miscounts the asks; split on the
marker first.

## Read this before trusting anything downstream

Three limits, stated up front because each one bounds what the scenarios can claim.

**1 — The corpus is tiny and short.** `pagination.totalHits = 20` over a 365-day
window. 20 traces, spanning `1786368429259`–`1786545069220` (2026-08-12 →
2026-08-14). Every trace carries `langwatch.origin: langy` and `service.name:
opencode`.

Two fields matter and are easy to confuse. All 20 traces have top-level
`project_id = project_6FujhzZ3VwRlZl01TE9os` — this is Langy's own telemetry
project, the one the supplied credential scopes to. The `langwatch.project_id`
*metadata attribute* is different: it records the project the user was asking
**about**, and it holds **7 distinct values**. So this is real Langy usage across
seven projects, not one person poking at their own. That is better provenance than
a single dogfood project — but it is still **~2 days and 20 traces**, nowhere near
a corpus of "what people have been asking". If a broader one exists — support
threads, Slack — it is not here, and these scenarios do not draw on it.

Group by `langy.conversation_id` (11 conversations), not `thread_id` (15). The
latter is the opencode session, and one conversation can span several.

**2 — Only 4 of the 20 traces captured Langy's ANSWER.** The other 16 record the
user's message with no output. So for most asks I know what was asked and not what
was answered. The scenarios label themselves accordingly:

| trace | ask | output captured |
|---|---|---|
| `langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf` t1 | off-topic evaluator traces | ✅ |
| `langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf` t2 | what about the last 30 days? | ✅ |
| `langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf` t3 | what's wrong with this agent | ✅ |
| `langyconv_0007Mjo9oVxP8sw3dZXUY2BGiH1id` | traces where you submitted PRs | ✅ |
| `langyconv_0007G8vXpb81lrGQodhV3lztlRq9c` | average duration of traces in scope | ❌ |
| `langyconv_0007Q4qJlI5TqeM18QnikIeWjWH0T` | experiments on a schedule (×2 traces) | ❌ |
| `langyconv_0003oPew2MUUI3XonIkPvZlrPwl7r` | walk me through my first trace | ❌ |
| remaining | greetings + smoke-test noise | ❌ |

**3 — Zero traces carry any span (0/20).** There is no tool-call record anywhere in
this corpus. So nothing here can evidence *how* Langy answered — which tool it
called, whether it searched traces. Every criterion in the scenario file is
therefore written against the **reply text**, never against mechanics.

## Ask count: 11 conversations = 5 noise + 6 genuine

Stated explicitly because "six asks" is otherwise an unbacked number.

- **Noise (5 conversations):** `database`, `models`, and `test` in three separate
  conversations. Single-word smoke tests, no intent to answer.
- **Genuine (6 conversations):** the six sections below.

## The six genuine asks

### 1. Diagnose-the-empty-result — `langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf` (3 turns) — OBSERVED

The only conversation where every turn's answer was captured.

| turn | user | Langy |
|---|---|---|
| 1 | `I want to see all of the off topic evaluator traces AND what's related` | `No off-topic evaluator traces in last 24h.` + `Off-topic quality is unmonitored: no online monitor exists, and the configured evaluators do not assess topicality.` |
| 2 | `what about the last 30 days?` | `No off-topic evaluator traces in the last 30 days.` |
| 3 | `what's wrong with this agent` | `No production traces in the last 24h, so there is no failing behavior to diagnose.` |

The turn-1 user message contains a **non-breaking space** (`c2 a0`) before
`what's`. The scenario file reproduces it verbatim, byte for byte.

Two behaviours worth pinning, both observed **passing**:
- An empty result is **diagnosed, not just reported** — turn 1 explains *why* there
  is nothing. A bare "no results" would be the failure.
- **Cross-turn scope carry** — "what about the last 30 days?" names no subject.
  Langy re-ran the same query on the new window without asking what "that" meant.

Both become scenarios, and both are regression pins: they lock in behaviour that
demonstrably happened.

### 2. `I want to know the average duration of traces in scope` — `langyconv_0007G8vXpb81lrGQodhV3lztlRq9c` — no output captured

I do not know how Langy answered this. No scenario written — analytics aggregation
is already covered by the existing suite, and I have nothing new to pin.

### 3. `show me the traces where you submitted PRs?` — `langyconv_0007Mjo9oVxP8sw3dZXUY2BGiH1id` — OBSERVED

Answered concretely: `24 Langy traces. The ones that produced PR submissions are:
bff50dc22c… — opened PRs #2375 and #2376 …`. Trace ids **and** PR numbers, not a
count. Good behaviour, but trace-search specificity is already pinned by
`langy-dogfood.scenario.test.ts`. No new scenario.

### 4. `Is it possible to set experiments to run on a schedule?` — `langyconv_0007Q4qJlI5TqeM18QnikIeWjWH0T` — SPECIFIED

Asked twice (2 traces), answered in neither. A **capability question** about the
product, not a query over the user's data — a failure mode distinct from every
other ask here, since both "refuse as out of scope" and "answer with a data
lookup" are wrong. Becomes a scenario, but the criteria are **my specification of
a good answer**, not a record of one. It may fail on first run.

### 5. `Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.` — `langyconv_0003oPew2MUUI3XonIkPvZlrPwl7r` — SPECIFIED

**One turn**, no output captured. (An earlier draft of this doc attributed this ask
to `langyconv_00076KHAD5ANla4086BGBS6PLBkWu` and called it "6 turns" — that is a
different conversation whose asks are `hi` / `heeloo`. Corrected.)

The interesting one regardless: the user **explicitly instructs Langy to ask a
question**, colliding head-on with `LANGY_CORE_RULE_CRITERIA`'s "does NOT ask the
user a clarifying question". An explicit instruction has to outrank the default.
The scenario drops that one core criterion, the same carve-out
`LANGY_EVAL_CREATION_CRITERIA` already makes. Its second exchange is invented — the
user never sent a follow-up — so this scenario is specification throughout.

### 6. `hi` / `heeloo` — `langyconv_00076KHAD5ANla4086BGBS6PLBkWu` (6 turns)

Greeting. Covered by the existing `LANGY_GREETING_CRITERIA`. No new scenario.

## What is NOT in this corpus

Nothing about datasets, prompts, dashboards, triggers, monitors, cost, or red-team
probes — all of which the existing 42-scenario suite already covers. The mined asks
add four behaviours the suite does not pin: empty-result diagnosis, cross-turn
scope carry on a subject-less follow-up, capability-vs-data questions, and an
explicit user instruction overriding a core rule. **Two are observed, two are
specified.**

## Status: these scenarios have never been executed

Written and typechecked, not run. Three independent blocks, each checked rather
than assumed:

- No `OPENAI_API_KEY` in this worktree — the judge and user-simulator both need it.
- No `.env`, and no local stack on `:1355` (curl → `000`).
- Production is up (`204`), but `langy-agent.ts` authenticates with
  **email + password** via `POST /api/auth/sign-in/email`, not an API key. The
  supplied `sk-lw-` credential cannot drive it.

That last point is the structural one, and it is not a missing password. The
key-authed surface merged in #6844 (`POST /api/langy/conversations`) returns **202
with `{conversationId, turnId}`** and has **no read or stream path** — the
streaming scenario in `specs/langy/langy-api-key-turns.feature` is still
`@unimplemented`. A scenario needs to read the assistant's reply to judge it, so
an API key cannot drive Langy end-to-end today no matter how the adapter is
configured. Closing that gap is a prerequisite, not a configuration step.
