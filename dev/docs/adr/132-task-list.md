# ADR-132 atomic task list

Tracking list for the work described in `132-implementation-ladder.md`. That
document says what each rung is and why it sits where it sits. This one breaks
each rung into single actions, so that "done" is never a judgement call.

One line is one action: one edit to one file, or one command with a pass or a
fail. Nothing here needs interpretation to check.

Marks: `[ ]` not started, `[~]` in flight, `[x]` done, `[!]` blocked.

All of it lands in pull request #8139 on branch `worktree-shiny-zooming-kahn`.

Scenario titles in quotes come from `specs/coding-agent/pi-session-capture.feature`.
Stripping a tag means deleting `@unimplemented` from that scenario's tag line,
leaving `@unit` or `@integration` in place.

---

## Rung 1 — accept pi in both launch modes

- [x] 1.1 `governance/tool-env.ts` — added the `pi` case so the gateway path stops throwing 501. **Reversed by 23.6: the case is deleted and must stay deleted.** It set a base URL pi ignores and an `OPENAI_API_KEY` pi does send — to the real vendor, which echoes it back in the 401 body. The 501 this atom removed was the system refusing to do something it could not do; the atom read it as a gap and filled it. Left ticked with the reversal attached: the sequence 1.1 → 23.6 is the record of the whole misreading.
- [x] 1.2 `governance/otel-env-block.ts` — add `pi: "pi"` to `SOURCE_TYPE_BY_TOOL`
- [x] 1.3 `governance/otel-env-block.ts` — confirm the no-branch fallback in `buildOtelEnvBlock` gives pi endpoint and headers only, and add no pi branch if it does
- [x] 1.4 `__tests__/wrapper-mode.unit.test.ts` — test that pi resolves in the gateway mode without throwing
- [x] 1.5 `__tests__/wrapper-mode.unit.test.ts` — test that pi resolves in the no-virtual-key mode without throwing
- [x] 1.6 `__tests__/wrapper-mode.unit.test.ts` — bind both with `@scenario "pi is accepted as a tool that can be launched"`
- [x] 1.7 `scripts/check-feature-parity.ts` — delete the `LEGACY_INERT` entry for the pi feature file and its comment
- [x] 1.8 spec — strip the tag on "pi is accepted as a tool that can be launched"
- [x] 1.9 run the wrapper-mode unit suite, green — 47 passed, and each half was armed by breaking it separately, so neither is vacuous
- [x] 1.10 run the feature-parity check, green — the file is now measured and reports 2/2 bound
- [x] 1.11 record the base-URL gap this rung uncovered (below), rather than guessing around it

### The base-URL gap rung 1 uncovered

Launching pi through the gateway is now accepted, and for pi's openai and chat
lanes it is correct. For an `anthropic/*` model it is not.

pi takes a single base URL for every lane, in one variable
(`services/langyagent/adapters/pi/spawn.go:24`). It appends `/chat/completions`
on the openai lanes and `/v1/messages` on the anthropic lane, prepending nothing.
So the openai lanes need a base ending in `/v1` and the anthropic lane needs one
that does not. langy resolves this by stripping the suffix when the model starts
with `anthropic/` (`spawn.go:395-400`), which it can do because langy chooses the
model. The command-line tool does not know the model when it builds the
environment, and the user can change it mid-session.

Rejected: reading `defaultProvider` from pi's settings and stripping on that.
It only moves the breakage — a stale setting then breaks the openai lanes
instead, and a mid-session model change breaks either way. Trading one wrong
answer for another is not a fix.

This does not block capture. Capture reads pi's session file and runs in the
no-virtual-key mode, where no base URL is rewritten at all. What it means is
that a gateway launch of pi against an anthropic model gets a doubled path
segment. It needs either a per-lane base in pi or a gateway that accepts both
join shapes, and both are outside this ADR. Filed as a follow-up.

**Corrected by rung 23, and the correction is larger than the gap.** The two
paragraphs above assume a gateway launch of pi happens at all and merely joins
the path wrongly on one lane. It does not. Every catalog model's address is
fixed in pi's own build, so a base-URL override is accepted and ignored on
*every* lane, not mis-joined on one. There is no doubled segment because there
is no swap. The anthropic-lane asymmetry described above is real in langy's own
worker, which is where it was measured; reading it as pi's behaviour was the
mistake, and it is the same stale belief that had to be corrected in three other
places today. Left standing with the correction attached rather than rewritten
clean: this paragraph is where the misreading is legible.

**No follow-up was ever filed.** "Filed as a follow-up" above is false — the
out-of-scope table lists #8129 through #8135 and none of them is the working
gateway path for pi. Whether to file it is the lead's open question to the user;
until then the knowledge lives here, because the two sentences below are the
part that must not be lost:

> Do not implement this by writing a generated `models.json` into the user's pi
> install. pi resolves that file for every session, so it would repoint runs the
> user never launched through LangWatch at our gateway — changing the behaviour
> of a tool we were only asked to observe, on sessions outside our scope.
>
> ADR-132's "write nothing to the user's machine" invariant is load-bearing
> here, not a stylistic preference: it is what prevents that. A working gateway
> path needs a per-lane base URL inside pi, or a gateway that accepts both join
> shapes, and neither is negotiable around by touching the install.

That is the trap this whole line of work walked up to and stopped at. Anyone
picking the ticket up will reach for the generated file first, because it is the
obvious fix and it works — for the sessions we launch, while silently changing
the ones we did not. Rung 17's read-only test is what keeps that closed.

## Rung 2 — a governable policy entry in both copies of the tool list

- [x] 2.1 `governance/platform-tool-policy.ts` — add `pi` to `PlatformToolSlug`
- [x] 2.2 `governance/platform-tool-policy.ts` — add the pi entry to `PLATFORM_TOOL_POLICIES`. **The reason written here was false and rung 23 reversed the values.** This atom said "both paths allowed; pi honours a base-URL swap". pi does not: every catalog model's address is fixed in pi's own build, so the swap is accepted and ignored. Because the two capture paths are mutually exclusive in the launcher, allowing the dead one also skipped the live one — the result was not a degraded gateway run but total silent capture loss for exactly the customers holding keys, plus the user's virtual key sent to the real vendor endpoint. Now `{ allowVk: false, allowOtelDirect: true }`, forced at both server sites and the tile override. Left ticked with the correction attached rather than rewritten clean: this line is where the defect entered, and a record that hides its own wrong turn teaches nothing.
- [x] 2.3 new `ee/governance/services/__tests__/platformToolPolicy.drift.unit.test.ts` — read both copies from disk and assert they name the same tools
- [x] 2.4 run the drift test and **watch it fail** — red, naming `only in the launcher: pi`
- [x] 2.5 `ee/governance/services/platformToolPolicy.service.ts` — add pi to `PLATFORM_TOOL_SLUGS`
- [x] 2.6 same file — add pi to `PLATFORM_TOOL_POLICY_DEFAULTS`
- [x] 2.7 same file — add pi to `PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE`, the lookup that otherwise skips the direct-telemetry check in the permissive direction
- [x] 2.8 bind the drift test with `@scenario "The two copies of the governed tool list name the same tools"` — title byte-compared against the spec
- [x] 2.9 spec — tag stripped by the lead; verified in the file, the scenario now carries `@unit` alone and parity counts it
- [x] 2.10 run the drift test, green — 6 passed, and each of the three lists was verified to fail the test when pi is removed from it

Three things this rung produced.

**The source-type map needed its own guard, and got one.** 2.7 is a one-line
edit whose omission is invisible: an unmapped source type leaves `policedSlug`
undefined at `auth-cli.ts:2582` and the `allowOtelDirect` branch never runs, so
an organisation that switched pi's direct path off would still be issued a key.
The scenario does not describe that map, so the drift test carries a second,
unbound assertion: every tool the launcher stamps a source type for, whose
policy permits direct telemetry, must map back to that tool. It went red on
removing 2.7's line and green on restoring it. Without it, 2.7 was the only atom
in the rung nothing could check.

**The rung has three failure directions, not one.** Removing pi from the
launcher copy, from `PLATFORM_TOOL_SLUGS`, and from the source-type map each
fail a different assertion with a different message. All three were run.

**The binding is not yet counted.** The parity check reports the pi feature file
at 4/4 bound, which does not include this scenario: it still carries
`@unimplemented`, so the check skips it. The annotation's title was compared
byte-for-byte against the spec instead. 2.9 has since landed and it is counted;
the pi feature file now reports 25/25 bound.

## Rung 3 — let the server mint a personal ingestion key for pi

**My atom 3.5 was wrong and the builder was right to refuse it.** It asked for
a test to be tied to a scenario titled "A pi ingestion key can be minted and
its provenance names pi". No such scenario exists, and no minting scenario of
any title exists — the ladder says this rung is enabling work with no scenarios
at all, and my atom list contradicted it. Tying a test to a scenario that does
not exist binds nothing while reading like coverage, which is the exact failure
this ladder keeps finding. Dropped rather than papered over with an invented
title.

**A hole is open until rung 2 lands.** The mint route only enforces an
organisation's policy on agents that appear in one particular lookup, and pi is
not in it yet, so a pi key mints even for an organisation that has switched pi
off. Rung 2 fills that lookup. Until it does, the permissive direction is the
one that is live.

- [x] 3.1 `ee/governance/services/ingestionKey.service.ts` — add pi to `PERSONAL_INGEST_SOURCE_TYPES`
- [x] 3.2 confirm by reading that `isWrappedTool("pi")` now passes and the mint no longer throws
- [x] 3.3 `ee/governance/services/ingestKeyProvenance.utils.ts` — add pi to `CODING_AGENT_SOURCE_TYPES`; without it the key mints but every captured pi session is stamped as a plain tool and drops out of the coding-agent views
- [x] 3.4 run the ingestion-key unit suites, green — and each of the two edits was removed separately and watched go red first, so neither is vacuous

## Rung 4 — the pi agent definition, appended last, bounded match rule

An adversarial pass proved this rung's second scenario measured nothing, after
it had already been counted as passing and reported as done.

**It passed with pi deleted.** The scenario said an established agent is not
relabelled as pi. Its test checked that two established agents identify
correctly — and they do that perfectly well when pi does not exist at all.
Removing pi from the list entirely left it green. Even giving pi a rule that
claims every record left it green, because the list is read in order and stops
at the first agent that answers, so a seventh entry is never reached for a
record the first six already claim. It was a test of the other agents wearing
a pi title.

The fix puts the shape of the list into the same test that carries the
scenario: pi must be present, and pi must be last. Both breakages were then
armed and watched go red — pi deleted, and pi moved to the front — and the
list restored and re-run green.

**The guard the ADR leans on was invisible to the gate.** The position check
was deliberately left unannotated, on the reasoning that it should fail on its
own. Failing on its own and being counted are different things: the gate walks
from scenarios to tests and never the other way, so an unannotated test is one
the gate cannot see. Someone could have deleted it and the gate would still
have reported everything bound. It is annotated now and still separate.

**The lesson worth carrying to the rungs still unbuilt:** a test that asserts
only an outcome can be blind to the thing it is named after, if something else
already guarantees that outcome. Ask of every one of them: if the feature were
deleted outright, would this go red? If not, it is not measuring the feature.

- [x] 4.1 `agents/_types.ts` — add `"pi"` to the `CodingAgent` union
- [x] 4.2 new `agents/pi.ts` — definition with `id: "pi"` and `logsOnly: true`
- [x] 4.3 same file — a bounded match rule that cannot fire on `anthropic` or `copilot`, both of which contain the letters
- [x] 4.4 `agents/index.ts` — append pi as the last registry entry, with the reason it must stay last
- [x] 4.5 new `agents/__tests__/pi.unit.test.ts` — assert the matcher is false for anthropic-shaped and copilot-shaped signals
- [x] 4.6 same file — assert claude and copilot signals still resolve to themselves through the real registry
- [x] 4.7 same file — an **unbound** case asserting pi is last, so a reorder fails on its own
- [x] 4.8 bind 4.5 with `@scenario "pi's match rule does not fire on a scope or service that merely contains its letters"`
- [x] 4.9 bind 4.6 with `@scenario "An existing agent's session is not relabelled as pi"`
- [x] 4.10 spec — strip the tags on both
- [x] 4.11 run the pi agent unit test, green — 3 passed, and each guard was verified to fail when the bug is put back

The rule does not use the shared substring helper the other six agents use.
That helper tests the scope and the service for the needle anywhere inside
them, and pi's two letters sit inside both `anthropic` and `copilot`, so a
plain use of it relabels every Claude Code, Cowork and Copilot record as pi.
Both arms are delimited instead: a dotted name prefix and an exact service
name.

**Constraint this places on rung 9.** The matcher only fires on names beginning
`pi.` and on the service name exactly `pi`. If rung 9 emits anything else, no
test fails and no error is raised — the records simply never resolve to pi.
This is the silent seam the ladder flags, and rung 9 owns closing it.

## Rung 5 — register the hidden `langwatch pi` subcommand

**There is a seventh hand-copied list, and this plan did not know about it.**
The count of places that must be edited by hand to add an agent was taken as
settled. Registering the command broke a test in a file no rung mentions — one
more list, enumerating every command, with its own expectation that anything
absent from it is a mistake. It was found by a failing test rather than by the
survey, which is the whole problem with these lists: the survey is itself
hand-made, so it can miss one exactly the way the code does.

Follow-up #8134 is the issue that proposes deriving these lists from one
source. Its evidence should say seven, not six, and should say that the
seventh was found by accident.

**Deliberately left undone here:** pi is registered but not listed in the help
text's line of coding assistants, and the installer flow was not touched. Both
would advertise a capture that does not exist yet. They belong to the change
that finishes capture, and the code carries comments saying so.

- [x] 5.1 `cli/commands/wrap.ts` — add the pi shim beside the others
- [x] 5.2 `cli/program.ts` — register the command hidden, mirroring the opencode registration
- [x] 5.3 `cli/utils/commandCatalog.ts` — add pi to `PLUMBING_COMMANDS`
- [x] 5.4 `cli/daemon/eligibility.ts` — add pi to `DENIED_COMMANDS`
- [x] 5.5 `features/langy/__tests__/capabilityCatalog.coverage.unit.test.ts` — add pi to `EXCLUDED_COMMANDS`
- [x] 5.6 new test asserting the command exists and is hidden from help output
- [x] 5.7 bind it with `@scenario "The pi command runs but is not advertised yet"`
- [x] 5.8 spec — strip the tag
- [x] 5.9 run the command-line test suite, green
- [x] 5.10 run the capability-catalog coverage test, green — it parses `program.ts` and fails the moment pi appears unexcluded

## Rung 6 — lift the agent-neutral rollout machinery out of the codex path

- [x] 6.1 decide the shared module name and create it — `governance/agent-rollout-transport.ts`, 261 lines
- [x] 6.2 move the directory walk into it — the fixed depth limit became a parameter
- [x] 6.3 move the spool drain into it
- [x] 6.4 move the refusal handling into it — templated on the tool name
- [x] 6.5 move the transport post into it
- [x] 6.6 move the batcher into it, timer behaviour and early return intact
- [x] 6.7 the modification-time window is neutral and moved; the codex filename test stayed behind as a passed-in predicate
- [x] 6.8 leave the codex body builder, trace-id handling and service naming behind — 730 lines down to 603
- [x] 6.9 update every import site — **zero needed it**; all six pieces were private to the module
- [x] 6.10 run all codex suites, green — 8 files, 94 tests; the whole governance directory, 56 files, 877 tests
- [x] 6.11 record the error count before and after, delta zero

Two corrections this rung produced.

The ladder said six test suites import from the codex module. Only three do,
and none of them changed. The count was wrong.

No test asserts the wording of the refusal message, so templating it on the
tool name is checked by eye and by nothing else.

## Rung 7 — resolve pi's session directory four ways

An adversarial pass killed this rung's scenario after it was already counted as
passing. Three findings, all now fixed, all worth keeping written down.

**The fourth way was measured by nothing.** The scenario named three ways of
moving the directory and stopped. The fourth is the one where the user has
moved nothing at all, which is every user on their first run. Breaking it left
every counted test green. Six tests did cover it; none of them was annotated,
so none of them counted. Two are annotated now, and breaking the default was
confirmed to turn one of them red before this was called done.

**A table of examples is counted as one, not as one per row.** The checker
reads the title and never looks at the rows underneath it. So a scenario can
advertise four ways while one annotated test satisfies the whole table. Rows
are a promise to a human reader, not a thing the gate enforces. Every row needs
its own test on purpose, because nothing will notice if it does not have one.

**The scenario claimed a read that does not happen.** It said the session is
read from that directory. Nothing reads a session yet — the resolver has no
caller anywhere in the product, only its own test. Passing on that wording was
passing on a promise. The wording now says we look in that directory, which is
what is true, and reading is asserted by the capture scenarios against a real
session file.

**Open, and rung 10 owns it:** this resolver is still called by nothing. Until
rung 10 wires it to the reader, all it proves is that a function returns a
string.

- [x] 7.1 new `governance/pi-session-dir.ts`
- [x] 7.2 precedence 1 — `--session-dir` from the passed-through arguments, both spaced and equals forms
- [x] 7.3 precedence 2 — the session-directory environment variable
- [x] 7.4 precedence 3 — the settings-file key, falling through on a missing or malformed file rather than throwing
- [x] 7.5 precedence 4 — the default location
- [x] 7.6 new test covering all four levels plus the malformed fallthrough, against a temporary directory, never the real home
- [x] 7.7 bind it with `@scenario "A session kept somewhere other than the default place is still found"`
- [x] 7.8 spec — strip the tag
- [x] 7.9 run the test, green — 22 passed

One choice worth naming: when the flag is given twice, the last one wins. That
matches the argument-parsing convention the rest of this tool assumes, but pi's
own parser was not read, so it is a convention and not a verified match. It only
matters for a duplicated flag.

## Rung 8 — read the session header, treat a missing file as normal

- [x] 8.1 new `governance/pi-session-file.ts`
- [x] 8.2 parse the header row and expose the session identifier, the working directory and the format version
- [x] 8.3 a missing file returns nothing and reports no error
- [x] 8.4 a malformed row is skipped, not fatal
- [x] 8.5 new test binding `@scenario "A session abandoned before pi wrote anything records nothing and reports no error"`
- [x] 8.6 spec — strip the tag
- [x] 8.7 run the test, green

## Rung 9 — build turn events from pi's rows, in order, named pi

- [x] 9.1 new `governance/pi-session-otlp.ts`
- [x] 9.2 fix the event names, and check each one against what `agents/pi.ts` maps — this is the seam the ladder flags as most likely to disagree silently
- [x] 9.3 emit the conversation in file order
- [x] 9.4 stamp the agent as pi regardless of which provider answered the turn
- [x] 9.5 emit events only, never spans
- [x] 9.6 bind `@scenario "A captured pi session shows the whole conversation in order"`
- [x] 9.7 bind `@scenario "The record names pi even though another provider answered"`
- [x] 9.8 bind `@scenario "Capture sends events and no spans"`
- [x] 9.9 spec — strip all three tags
- [x] 9.10 run the test, green

## Rung 10 — map cost, and leave unreported measurements blank

- [x] 10.1 map cost from assistant turns — done by rung 9 (`assistantAttributes`)
- [x] 10.2 map cost from work inside tools — the billed tool result now emits its own `api_request` beside the `tool_result`
- [x] 10.3 map cost from summarised stretches — the same event, for a `compaction` or `branch_summary` entry that carries usage
- [x] 10.4 a turn charged nothing records a real zero — done by rung 9
- [x] 10.5 a turn carrying no cost field at all is left blank, not zeroed — done by rung 9
- [!] 10.6 measurements pi never reports are left blank, not zeroed — the scenario is a presentation claim the projection cannot bind; see below
- [x] 10.7 verify the cost-bearing events land as the one canonical request event the session fold reads cost from, or the total is right in a test and wrong in the product
- [x] 10.8 bind the four cost scenarios — three of the four; 10.6's stays open
- [x] 10.9 spec — strip the four tags — three stripped (two by the lead in rung 9's pass, one here); 10.6's stays on
- [x] 10.10 run the test, green — 5 new + 275 in the pipeline's unit suite + 953 in the CLI's, all green

### 10.2 and 10.3 were real, and the builder was dropping the money

Rung 9 measured 0 of 69 tool results carrying usage and concluded the atoms
might be unimplementable. Widening the measurement to all five sessions on this
machine gives the same answer — 48 of 48 assistant rows billed, 0 of 69 tool
results, 0 compactions in 156 rows — but the absence is a property of the
sessions, not of the format. pi documents both carriers and counts both in its
own totals: `session-format.md:99` (`usage?: Usage; // Nested LLM work performed
by the tool`), `:244` and `:259` (the compaction and branch summaries, "included
in session token and cost totals"). A tool that farms work out to a model is
exactly the shape that bills here, and none of the measured sessions used one.

So they are built to the documented format rather than to a measured example,
and that is stated in the code rather than implied.

### 10.7 — the seam was live, and it decides the whole rung

`pi.api_request` is correct, verified by executing the real path rather than by
reading it. The chain: `stripAgentPrefix` takes `pi.` from the registry's
`namePrefixes` → `api_request` → `CLAUDE.EVENT.API_REQUEST` at
`coding-agent-session.derivation.ts:984` → `logsOnly` on the pi definition puts
the reported figure into `costUsd`, not only `agentReportedCostUsd`.

It matters because the failure is silent and total. Putting the tool's cost on
the `tool_result` event it belongs to — the obvious place, and where a reader
would look for it — passes every builder test and lands **$10 of $15** in the
product. That was measured, not reasoned: the falsification run swapped the one
event name and the session total dropped to 10 with nothing raised anywhere.

The new test (`services/__tests__/pi-capture-cost.unit.test.ts`) runs the
builder's real output through `liftCodingAgentLogFacts`, `detectCodingAgent` and
`applyLogToCodingAgentSession` — the three filters between the payload and the
total, each of which can drop a cost while every builder test stays green. Five
independent breaks were made in production code one at a time and each turned it
red: the event name, the emission itself, `cost_usd`'s place on the attribute
allowlist, pi's `namePrefixes`, and pi's `logsOnly`.

### 10.6 is refused as written, and the tag stays on

"Measurements pi never reports are left blank rather than shown as zero" cannot
be bound truthfully at the level this rung works at. The projection holds
`linesAdded`, `linesRemoved`, `commits` and `pullRequests` as plain numbers
initialised to 0 (`coding-agent-session.derivation.ts:375-378`) and only a
METRIC contribution moves them — pi sends none, so they stay at a literal zero.
A test asserting that would contradict the scenario's own words.

The blankness is real, and it is `SessionView.tsx:522` and `:547` declining to
render a zero stat. That behaviour is agent-agnostic and predates pi: a test of
it passes with every line of the pi capture deleted, which is the same vacuity
rung 9 already rejected at the builder.

What IS pi's own is pinned, unbound, in the same file: a capture that folds real
cost, tokens and model calls moves none of the four measurements off their
starting value, with the cost assertion in front of it so the test cannot pass
by folding nothing. Breaking the fold to count a commit per prompt turns it red.
Binding the scenario needs either a UI test of the stat gate or a spec sentence
that says what the capture does rather than what the screen shows — both the
lead's call, not this rung's.

### Resolved: the scenario is DELETED, not parked

The lead's call, made after rung 13-14 was asked to bind it at the agent
definition and refused. The scenario is gone from the feature file; there is
nothing left to bind and nothing to un-park.

Rung 9 refused it as vacuous at the builder, rung 10 re-refused it above and
escalated, and rung 13-14 reached the same verdict a third time from a cold
start without having read either. Three independent passes over one scenario is
the signal: the claim is not hard to bind, it is **false**. `linesAdded`,
`linesRemoved`, `commits` and `pullRequests` are declared bare `number` at
`coding-agent-session.types.ts:306-309`, and `recomputeMetricOverlay` initialises
all four to 0 and returns them unconditionally
(`coding-agent-session.derivation.ts:1328-1379`; rung 10 cited `:375-378`, the
same fields before the file moved). They cannot be blank at any layer we reach.
The only way to make the sentence true would be to change production nullability
to fit a spec, which is writing the feature backwards.

Two things this pass adds to rung 10's account:

- **The falsification proposed for it could not have compiled.** The suggestion
  was to add `?? 0` to the pi agent definition. `CodingAgentDefinition` has no
  value-mapping field of any kind (`agents/_types.ts:117-209`); its only
  measurement-adjacent member is `metricAliases`, which maps a vendor metric
  *name* to a canonical *kind*. There is nowhere in any agent definition to
  default a measurement to a number.
- **The `opencode.ts` precedent is a different concern.** Leaving
  `lines_of_code.total` unmapped (`opencode.ts:9-11`) avoids double-counting
  against the `.count` delta. It is name-alias hygiene, not a zero-default, and
  does not establish that agent definitions supply measurement values.

The deciding argument is rung 4's question. If pi were deleted from the
repository outright, a `SessionView` `> 0` test would pass unchanged, because
the guards at `SessionView.tsx:518-524`, `:544` and `:547` are generic over every
agent. A scenario in `pi-session-capture.feature` that survives pi's deletion is
decorative with respect to pi whatever else it proves — rung 2's defect one
layer out.

The display guard is still worth a test, and it is **not** a pi binding: it
belongs in `specs/trace-drawer/`, where no feature currently covers the Outcome
block. Filed as a follow-up rather than taken here.

## Rung 11 — tail across passes

Both rungs land in one module, `governance/pi-session-stream.ts`, because they
are one piece of state: the cursor that says where a file has got to and the
set that says which rows have already been sent. Splitting them would have been
two agents editing one file.

- [x] 11.1 `stat` on every pass; the remembered offset is only ever compared against the size it returns
- [x] 11.2 read the bytes between the offset and the size, and emit the rows in them
- [x] 11.3 a smaller size means the file was replaced — re-read from zero and **keep** the seen-set
- [x] 11.4 consume only as far as the last newline, so the bytes under a torn line survive for the next pass
- [x] 11.5 new `__tests__/pi-session-stream.unit.test.ts` binds `@scenario "Turns appended after a read are picked up by the next one"` — twice: a three-then-two append, and the real 132-row session fed in through three arbitrary byte offsets
- [x] 11.6 binds `@scenario "A session that stopped without shutting down cleanly keeps the turns pi had written"` at the reader, one layer above rung 8's parser test on the same scenario
- [x] 11.7 spec — both tags stripped (`:62`, `:85`)
- [x] 11.8 11 tests green, and each of the four decisions was broken separately and watched go red

**A shrink is a replacement, and that decides what happens to the seen-set.**
Re-reading from zero while keeping the set is right in both directions: the
migration keeps the session id and the row ids, so the replay emits nothing,
and the offset lands on a real line boundary again so the next append parses.
Dropping the set — treating it as a new file — sends the whole session twice.

**A crash and a shrink look the same from outside, and are told apart by size.**
Crashed: the size is unchanged or larger and the last line is half a row.
Shrunk: the size is smaller than the offset. They are separate branches and
separate tests, and the falsifications below redden them separately.

**A remembered offset can land mid-line, and does.** Breaking only the newline
rule — advancing by the whole chunk rather than to its last newline — loses
exactly 2 of the real session's 127 events, with nothing raised. That is the
silent failure the rule exists for.

## Rung 12 — de-duplicate on session identifier plus row identifier

- [x] 12.1 the key is `sessionId + " " + rowId`; a row pi wrote without an id falls back to its position, never to the session id
- [x] 12.2 **no code was needed, and that is the finding.** Rung 8's parser hands the header back separately from `rows`, so it cannot enter the set. Recorded rather than papered over with a line that would have looked like work. A test does discriminate against the implementation the ADR warns about — a row whose id equals the session id is still emitted — and it goes red when the header is keyed on its session id
- [x] 12.3 binds `@scenario "The same turn is not recorded twice"` twice: the unchanged-file pass, and one session offered under two paths
- [x] 12.4 binds `@scenario "Two sessions sharing row identifiers are kept apart"` — two files whose rows carry **identical** ids under different session ids
- [x] 12.5 spec — both tags stripped (`:68`, `:79`)
- [x] 12.6 green; the parity gate exits 0 with the pi feature file fully bound — 20/20 when this rung landed, 25/25 once rungs 13 and 14 stripped their tags

**The first 12.3 test could not fail, and a second one was added.** The
unchanged-file pass returns early on an unchanged size and never reaches the
seen-set, so it stayed green with de-duplication deleted outright — rung 4's
lesson, arriving again. The second test offers one session under two paths,
which gets its own cursor, starts at zero, and re-offers every row; nothing but
the set stops those turns landing twice. It reddens when the set is removed.

**Where the seen-set actually earns its place.** The offset alone prevents
re-emission on the ordinary path. The set is load-bearing in exactly two
places: the replay after a shrink, and one session reached under two paths. It
is shared across every file the stream reads, which is what makes the session
half of the key do any work — a per-file set would make rung 12.1 unnecessary
and the fork hazard unreachable, at the cost of both cases above.

**A trap every remaining rung has to know about: only a single-line annotation
binds.** The parity checker walks forward from the annotation over whitespace,
whole `/* */` blocks and `//` lines, and then demands `it(` or `test(`
(`check-feature-parity.ts:1151-1177`). An annotation written inside a
multi-line comment leaves the walker standing on the ` *` continuation, which
is none of those, so it stops and the binding is discarded. This is true even
when the annotation is the block's last line — the walker meets ` */`, which it
also does not accept. Verified by calling the checker's own exported
`findScenarioAnnotations` and `isFollowedByTestCall` on four forms: the
single-line `/** @scenario "..." */` binds, a `// @scenario "..."` line binds,
and both multi-line forms are ignored. Nothing warns. The parity count is the
only witness, and only when the scenario has no other binder — a scenario bound
twice, once properly and once in a block comment, stays green while half the
intended coverage is imaginary. Swept every test file this branch touches
against the checker's own functions: 124 live bindings, 0 dead.

### The falsification matrix, re-run end to end

Seven breaks, one line each, against `pi-session-stream.ts`
(sha256 `718445e7…60e3d4` before and after every one of them, verified by
`diff`). The point of the table is the **green** column: a break that reddens
everything proves only that the module runs.

| Break | Red | Green |
|---|---|---|
| memoise the size instead of re-`stat`ing (11.1) | 5, both "Turns appended" tests among them | both dedupe scenarios — neither appends |
| refuse a chunk whose parse has a torn tail | **none — 11/11 still green** | — |
| require the chunk to end on a newline (11.4) | 2: the crash scenario, and the torn-line completion | the append scenario, both dedupe scenarios |
| delete the seen-set check (12.1) | 2: one session under two paths, and the shrink replay | the fork scenario, the append scenario |
| key on the row id alone (12.1) | 1: **only** the fork scenario | everything else |
| never reset the cursor on a shrink (11.3) | 1: only the shrink test | everything else |
| key the header into the set on its session id (12.2) | 1: only the id-collision test | everything else |
| consume the whole chunk, ignoring the newline (11.4) | 2: torn-line completion, and the real session at **125 of 127** events | the crash scenario |

**The second break is the one worth keeping.** `if (parsed.hasTornTail) return []`
looks like it should destroy the crash scenario and does nothing at all: the
chunk is trimmed to its last newline before the parser sees it, so
`hasTornTail` is unreachable from this module. An inert break is not a passing
test — it is a break aimed at code that cannot run. The rule the crash scenario
actually rests on is the newline trim, and the third break is what proves it.

**Two bound scenarios are covered by two tests each, and in both cases only one
of the pair does the work.** For "The same turn is not recorded twice" the
unchanged-file pass survives deleting the seen-set *and* both early returns —
it is caught by a third guard, the empty-chunk `lastIndexOf` — so the second
test is the one that measures de-duplication. For the crash scenario the bound
test survives break 8, and the unbound completion test is what catches it.
Neither pair is vacuous; neither is redundant either.

**Which tests are synthetic.** Nine of eleven. A half-written last line, a file
rewritten smaller, two files sharing row ids, and a row whose id equals a
session id are all states a healthy captured session never reaches, so there is
no real file to take them from. The tenth and eleventh are the real 132-row
session (sanitised, `__tests__/fixtures/pi-session-real-shape.jsonl`), cut at
three arbitrary byte offsets and asserted equal to one read of the whole file —
which is what caught the 2-event loss in the last break.

**Re-run against the post-rung-15 file, and nothing was lost.** The table above
was measured on the 239-line module, before rung 15's injected `resolveLineage`
option and before the `isLineageResolved` hardening. An added cursor field is
exactly the kind of change that leaves every test green while quietly making a
mutation inert, and this module has already produced one genuinely inert break,
so the eight were re-run one line at a time against the 324-line file
(sha256 `7235cd85…6969859e`, restored and **verified by hash** after every
break, not by eye — the pristine scratchpad copies from the first round had been
deleted).

Every red count held. Seven are identical, including the two that redden a
single named test each and the one that reddens nothing. The exception is the
first: **5 → 6**, the extra being the new `does not call the resolver again on
later passes` test, which appends a row between two passes and so cannot survive
a memoised size either. The count moved up, which is the safe direction; no row
fell, and the inert row is still inert.

That last point is the one to read carefully. The torn-tail row proves nothing
by staying at zero — a break that reddened nothing before and reddens nothing
now is consistent with both a healthy module and a dead one. It is a control,
not a guarantee: the informative outcome for that row would have been it
*starting* to bite.

### The never-throws contract, pinned at the seam (follow-up)

Rung 15 made the lineage resolver an injected parameter of
`createPiSessionStream`. That turned `read`'s "empty, and never an error"
contract into a promise about code this module does not own: `await
resolveLineage(header)` sat bare inside the pass, and it held only because
`resolvePiLineage` reports every failure as a blank parent through three
`try`/`catch` blocks of its own. A comment and three implementation details,
across a module boundary, with no test anywhere going red if a fourth code path
or a different resolver broke it. Capture would then die silently mid-session.

Closed with a `try`/`catch` at the call site and two tests that inject a
throwing resolver. Both are **deliberately unbound** — the spec has no scenario
for a resolver that throws, and inventing a title to bind them to is the exact
failure this ladder keeps catching.

The guard needed a third cursor state, not a second. A resolver that threw
leaves *asked and failed*, which is neither *not yet asked* nor *answered*.
Collapsing it into `lineage === undefined` retries the broken resolver on every
poll tick for the life of the session; collapsing it into `NO_LINEAGE` is worse,
because that value asserts `isFork: false` and a throw told us nothing about
whether this session is a fork — and `parent_session_id` is once-set downstream
and can never be corrected. Hence `isLineageResolved: boolean` alongside
`lineage`.

| Break | Red | Green |
|---|---|---|
| remove the `try`/`catch` entirely | both new tests | all 11 originals |
| keep the catch, drop `isLineageResolved` (retry on every pass) | 1: **only** the no-retry test — `expected 2 to be 1` | the contract test, all 11 originals |
| catch the throw, then `return []` | 1: **only** the contract test — `expected [] to deeply equal [ 'pi.user_prompt', 'pi.api_request' ]` | the no-retry test, all 11 originals |

The third break is the one the test was written for. A `read` that swallows the
throw and returns nothing satisfies "does not throw" and loses the session, so
the test asserts the rows come back intact rather than merely that no exception
escaped. Asserting the absence of a rejection alone would have stayed green.

**A thrown resolver is silent, by decision.** No stderr line. Lineage is an
enrichment on events whose content is already in hand, so losing it must cost
those attributes and nothing else. This is the reader the wrapper polls while pi
owns the terminal: a warning here lands in the middle of somebody's session, to
report the loss of an attribute they cannot act on. ADR-132 §2 settles the same
trade the same way for the harvest loop.

**The obligation this guard puts on resolver authors.** A resolver must never
reject after recovering a value: return what was learned and swallow the cleanup
failure. The reason is what makes the rule worth keeping, because the bare rule
reads as fussiness and gets deleted. A rejected promise carries no value, so
this seam physically cannot tell "failed to learn the parent" from "learned it,
then failed to clean up". It records the pessimistic answer for both — and that
answer goes into `parentSessionId`, which is once-set and never retried
(`coding-agent-session.derivation.ts:562`). A rejection of the second kind
therefore does not lose an enrichment that was unavailable; it discards one that
had already been recovered, permanently.

The live instance is `handle.close().catch()` in `resolvePiLineage`. A close is
not a plausible failure on a local disk, but a mount that defers write errors to
close throws out of the `finally` *after* the parent id has been read
successfully — the exact shape above. Until rung 13-14 pinned it, that catch was
covered by nothing: they broke all four catches in the module one at a time, and
dropping this one reddened zero tests while the other three reddened three and
one. It is now held by an injected handle that reads fine and refuses to close,
asserting the parent id still comes back rather than merely that nothing threw.

Two modules' contracts rest on that one guard, which is why it is written here
and not only there. The obligation is also stated in `resolvePiLineage`'s doc
comment, directly above the catch it explains, so a future reader who deletes
the catch has the consequence in view.

## Rung 13 — resolve lineage

- [x] 13.1 stamp the parent session attribute
- [x] 13.2 stamp the fork flag
- [x] 13.3 turn the parent file location into the parent's identifier by reading that file's header
- [x] 13.4 never store the parent's file location, which leaks a home directory path
- [x] 13.5 a deleted parent file leaves the parent blank
- [x] 13.6 confirm no server change is needed — the session fold already reads both attributes
- [x] 13.7 new lineage test binding the four lineage scenarios
- [x] 13.8 spec — strip the four tags
- [x] 13.9 run the lineage test, green

**Rung 13 notes.** 13.6 was confirmed by driving pi's exact attribute shape through
the real server chain and reading the output, not by reading the code: the
allowlist keeps both keys (`coding-agent-normalization.ts:332,334`) and a boolean
`is_fork` survives because `scalarStr` stringifies booleans
(`coding-agent-session.derivation.ts:424`). Two findings outside the atoms, both
load-bearing:

1. **Lineage must ride the common attribute block of every pi event, not its own
   event.** `applyLogToCodingAgentSession` returns state unchanged when
   `normalizeEventName` yields null, before `withIdentity` is reached — executed:
   a dedicated `pi.session_started` carrying both keys folded to
   `{parentSessionId: null, isFork: false}`. A lineage-only event would have been
   dropped whole and silently. Riding the common block also makes the once-set
   column safe, since whichever batch lands first is correct.
2. **A path-shaped value persists verbatim and forever.** A real home-directory
   path fed as `parent_session_id` folded through untouched, into a column that
   cannot be corrected. 13.4 is not a theoretical risk.

The 13.4 test asserts on the whole serialised payload rather than one attribute,
and writes its fixtures under a home-directory-shaped temp path so a bare `/tmp/x`
cannot pass an assertion a real path would fail. Falsification M3 — stamp the
parent path while leaving the identifier CORRECT — went red on the payload
assertion alone, which is the difference between checking the identifier and
catching the leak.

## Rung 14 — resuming records one session, not three

- [x] 14.1 make a resumed run fold into the session it resumed
- [x] 14.2 bind `@scenario "Resuming a session does not create a second one"`
- [x] 14.3 spec — strip the tag
- [x] 14.4 run the lineage test, green

**Rung 14 note.** 14.1 required no production change: pi appends to the same file
and the header id is established once, so a resumed run already folds correctly.
Rather than leave that as an untested assumption it was pinned to two specific
lines by falsification — dropping the `??=` on the cursor header made the resumed
turns vanish (`expected 1 to be 3`), and a per-run identity broke the id.

### The falsification matrix, rungs 13 and 14

Seven breaks, one line each. Hashes before and after every one of them, verified
by `diff`: `pi-session-lineage.ts` `21c8b670…c84e80`, `pi-turn-events.ts`
`c2da5e81…63d01b`, `pi-session-stream.ts` `718445e7…60e3d4`. As in rungs 11/12,
the **green** column is the point — a break that reddens everything proves only
that the module runs.

The stream hash is the value verified at the time M6 ran. That file has since
moved to `d9dd269c…86cb5` and grown 239 → 288 lines under another rung's work,
with the `??=` invariant intact; the suite is green against the new content. The
older hash is left as written because it is what M6 was measured against.

Counts below are after the fix described under the table: the leak assertions now
live in a test of their own, which is why M1, M2 and M3 each redden one more test
than they did when the guarantee was buried behind an identity assertion.

| Break | Red | Green |
|---|---|---|
| M1 fall back to the raw path when the parent header cannot be read (13.5) | 2: the deleted-parent test, and the leak-only test on the payload assertion | the bound leak test — its parent file resolves, so the fallback never fires |
| M2 use the path as the identifier outright (13.3) | 4 | the no-parent test, the resume test |
| M3 stamp `parent_session_file` beside a **correct** identifier (13.4) | 3: both leak tests and the deleted-parent test, all on the serialised payload | the two tests that assert only the resolved identifier |
| M4 derive the branch flag from the identifier, not the path (13.2/13.5) | 1: only the deleted-parent test | everything else |
| M5 stamp the branch flag even when false (13.2) | 1: only the no-parent test | everything else |
| M6 drop the `??=` on the cursor header (14.1, rung 11/12's file) | 1: only the resume test, `expected 1 to be 3` | everything else |
| M7 make the session identifier per-run (14.1) | 1: only the resume test | everything else |

**M2 is the break that looks stronger than it is.** Three red tests reads like
the widest net in the table, but the leak test among them dies on
`expected '/var/folders/…' to be '01a09b6b-41ae-747a-9edf-b238fff5fdae'` — an
identifier assertion, reached before the payload assertions run. So M2 never
exercises 13.4's leak check at all. M1 has the same shape from the other side: it
puts a real home-directory path into `parentSessionId`, the exact harm 13.4
exists to prevent, and the leak test stays **green** because that test's parent
file resolves normally. Neither of the two breaks that actually move a path into
the identifier is caught by the test named for path leakage. **M3 is the only one
that proves the leak assertions load-bearing**, and it is the only break that
leaves the identifier correct — which is why it had to be written that way.

**What was done about it.** The finding above describes the suite as first
written, and the defect was in the test, not in the table: an assertion already
written was unreachable under two of seven breaks. A guarantee provable by
exactly one mutation is a single point of failure — refactor whatever M3 aims at
and the leak guarantee silently loses its only proof, with nothing in the suite
saying so. So the leak check was hoisted into a test whose only job it is, with
no identity assertion in front of it, covering both routes by which a path can
reach the wire: a parent that reads (M2's route) and a parent that does not
(M1's). Both now fail it on the payload assertion —
`expected '{"resourceLogs":[{"resource":{"attrib…' not to contain '/var/folders/…'`.
The bound test M3 exercises is unchanged and still does its own work; the new
test is deliberately unbound, because it asserts nothing about which identifier
is correct, which is the entire point of it.

The lesson generalises past this rung and is recorded under Consequences in
`132-pi-as-tracked-coding-agent.md`: a leak assertion placed after an identity
assertion in the same test is unreachable whenever the break moves the identity
too. The identity assertions are still worth keeping — they are what M1, M2 and
M4 rest on — but the leak guarantee needed a test of its own.

**Which tests are synthetic.** Four of five. No real session on this machine has
a `parentSession` field — all five files under `~/.pi/agent/sessions/` are roots,
version 3, checked — so every split, deleted-parent and leak case is constructed.
Only the no-parent test uses the real 132-row session (sanitised,
`__tests__/fixtures/pi-session-real-shape.jsonl`). The resume test is synthetic in
its file but real in its mechanism: three appends to one file through
`createPiSessionStream`, which is how a resumed pi run actually behaves.

**Residual risk, stated plainly: lineage is proven against constructed headers
only.** Every claim rungs 13 and 14 make about a fork rests on a `parentSession`
field this rung wrote itself, to the shape pi documents — not on one pi has ever
been observed to emit. The first real forked session is the real test. No attempt
was made to manufacture one to close this gap, because a hand-built parent would
be the same constructed header wearing a better disguise.

**Two more breaks, after rung 11-12 reported depending on `resolvePiLineage` never
throwing.** The reader now awaits it inside a poll pass whose own contract is
"never an error", with no try/catch, so a rejection ends a tick of capture. That
dependency had been checked by reading the code — the same method that let the
leak assertion sit unreachable — so it was checked again by execution, against ten
kinds of unreadable parent (a directory, an empty file, binary, a first line past
the 64 KiB window, a broken symlink, a symlink loop, no read permission, valid
JSON that is not an object, a NUL byte in the path, a path past the length limit).

| Break | Red | Green |
| --- | --- | --- |
| M8 — read-side `catch` rethrows instead of returning null | 1: the new contract test only | the other 7, including the deleted-parent test |
| M9 — `open(path, "r")` instead of `O_RDONLY \| O_NONBLOCK` | 1: the FIFO test, `expected 'blocked' to deeply equal { parentSessionId: null, isFork: true }` at 3022ms | the other 7 |

M8's green column is the finding: before that test existed, deleting the read-side
catch reddened **nothing**. The never-throws contract someone else now relies on
was held by no test at all.

M9 fixed a real defect rather than pinning existing behaviour. Never-throwing is
not never-hanging: measured, a plain `open(2)` on a FIFO parent path returned
nothing and threw nothing after three seconds, and the probe process then would
not exit at all, because the blocked open wedges one of libuv's four threadpool
threads. A hang there is worse than the rejection rung 11-12 was worried about —
an error ends a tick, a hang ends capture and starves filesystem I/O
process-wide. `O_NONBLOCK` is a no-op on regular files, which is every parent
actually expected. Both new tests are deliberately unbound: they pin a contract,
not a scenario, so parity is unchanged at 25/25.

**Every catch in the module, falsified one at a time.** M8 proved the read-side
catch and nothing else, so the remaining three were run individually rather than
assumed covered. The module has four, not the three counted by reading.

| Break | Red | Green |
| --- | --- | --- |
| M10 — open-side `catch` rethrows | 3: the leak-only test, the deleted-parent test and the hostile-input test, all `→ open failed` | the other 6 |
| M11 — `JSON.parse` catch rethrows | 1: the hostile-input test, `→ parse failed` | the other 8 |
| M12 — `.catch` dropped from `handle.close()` | 0 at first. 1 after the fault-injection test was added, `→ close failed` | — |

M12 is the finding. Dropping that catch reddened nothing, because a close after
a successful open does not fail on a local disk — no hostile *input* can reach
it. But on a mount that defers write errors to close it would throw out of a
`finally` and discard an answer already read, which is exactly the rejection the
session reader has no try/catch for. It is the shape M8 found again: a guard
holding up another module's contract that no test could see. The fix is fault
injection rather than a filesystem fixture — a mocked handle that reads fine and
refuses to close — and it asserts the parent id still comes back, not merely
that nothing throws. Labelled in the test as fault injection, because it is
evidence about the guard and about no real filesystem.

Parity moved 25/25 → 30/31 while this ran; the growth and the one unbound
scenario at `pi-session-capture.feature:277` are rung 15's, and all five lineage
scenarios remain bound.

## Rung 15 — wire the reader into the wrapper

- [ ] 15.1 `governance/wrapper.ts` — add the pi streamer block, mirroring the codex one
- [ ] 15.2 **rewritten after rung 23 — the original premise is dead.** This atom
      used to read "gate it on the no-virtual-key mode only, so a gateway run
      never also posts from the file." There is no such thing as a pi gateway run:
      pi ignores base-URL environment variables, so rung 23 forces every pi launch
      onto ingestion regardless of the key. Gating on the mode is therefore a
      condition that is always true — which is the danger, because it LOOKS
      protective while guarding nothing. Worse, it is a loaded gun: if the rung-23
      policy is ever flipped back, this gate silently stops all capture with no
      error and no notice, which is total data loss for exactly the paying
      customers who hold keys. So: do NOT gate on the mode. Start the reader
      unconditionally for pi, and if you believe a gate is still warranted, make it
      assert loudly rather than skip quietly. Say which you chose and why.
- [ ] 15.3 stamp the run start time, so a session this run never touched is left alone
- [ ] 15.4 unreference the poll timer so it cannot hold the process open
- [ ] 15.5 skip a pass while the previous one is still in flight — **not for the
      reason the codex block gives.** `wrapper.ts:738-740` can call overlap
      harmless because a codex harvest is stateless and its span ids are
      trace-id-derived, so a duplicate collapses server-side. The pi stream is
      neither: two passes that interleave both read the same byte range and both
      run `cursor.offset += complete.length` (`pi-session-stream.ts:210`),
      leaving the offset a whole chunk past the end of the file. Nothing is sent
      twice — the seen-set catches that — but the next append is skipped until
      the offset happens to exceed the file size and the shrink branch resets to
      zero. Self-healing, silently, after losing turns. Copy the `inFlight` shape
      from `wrapper.ts:755-758`; do not copy its comment.
- [ ] 15.6 guard the final sweep after the child exits
- [ ] 15.7 bind the three wrapper scenarios
- [ ] 15.8 spec — strip the three tags
- [ ] 15.9 run the wrapper unit suite, green
- [ ] 15.10 **added after rung 13 — without this, lineage does not ship.**
      `resolvePiLineage` exists, is tested and binds five scenarios, but nothing
      outside its own file calls it: `buildPiTurnEvents(session, lineage?)` takes
      the optional second parameter and the stream's call site
      (`pi-session-stream.ts:232`) passes nothing. Rung 13 left it deliberately —
      resolving lineage opens the parent's file, and the stream does no I/O beyond
      its cursor — which is the right call and makes this the wrapper's job. Call
      `resolvePiLineage(header)` ONCE per session, not per pass, and hand the
      result to the stream. Verify by execution that a forked session arrives with
      a parent stamped: the five bound scenarios all test the resolver in
      isolation, so every one of them stays green with the wiring absent. That is
      the trap — a green suite here proves nothing about whether the feature
      ships.

**The retry buffer is memory, and that is a known limit rather than an
oversight.** Not in the atoms; found while wiring. The asymmetry with codex is
the reason it exists at all: `createCodexIOStreamer` marks a turn emitted only
after a successful post, so a refused or timed-out post retries on the next
tick. The pi reader cannot offer that, because it de-duplicates at READ time — a
row enters the seen-set before anything is sent, and the reader will never offer
it again. So the naive wiring loses every turn in a failed post, permanently and
without a word. `pi-capture.ts` therefore holds undelivered events and prepends
them to the next pass.

Two limits, both deliberate, both to be read as limits and not as bugs to be
rediscovered later:

- **Bounded, and loud when the bound is hit.** 20,000 events, past which the
  oldest go — an endpoint unreachable for an hour must not grow the wrapper's
  memory without limit. A bound that dropped quietly would only move the silent
  loss behind an invisible threshold, so the first drop writes to stderr and the
  exact total joins the undelivered count in the exit report.
- **It dies with the process.** If pi exits while turns are pending and the
  final sweep also fails, those turns are gone. "Buffered" here does not mean
  "durable", and nobody should read it that way. Surviving a crash needs a spool
  on the user's disk, which capture currently never writes to — a different
  decision with its own trade, and a follow-up ticket rather than part of this
  rung.

**One line ships untested, deliberately, and here is which.** The exit report
sums `piCapture.droppedCount()` into `pendingCount()`, and no test holds that
addition. Breaking it — reporting pending only — leaves all nine tests green.

It is unheld because arming it is a bad trade rather than because it was
overlooked. Driving overflow through the real `runWrapped` needs 20,001 events;
the wrapper does not expose `maxPending`, and **it should not** — that parameter
is a test seam on the capture, not a wrapper knob, and widening the wrapper's
surface to reach it would be the wrong repair. The remaining route is a second
wrapper harness that `vi.mock`s `../pi-capture` wholesale, roughly 200 lines,
and a module-level mock would blind the other five tests in that file to the
real capture. That is a cure that costs more than the disease and degrades five
real tests to buy it.

The line stays in regardless. Dropping it to avoid an untested addition would
make the exit report undercount by exactly the number of turns lost to overflow
— silent loss in the diagnostic written to report loss, which is the failure
this whole feature exists to prevent. An untested correct line beats a tested
wrong one.

## Rung 16 — capture never disturbs the coding session

- [x] 16.1 new `__tests__/pi-wrapper-noninterference.integration.test.ts`. It is
      the **first thing anywhere that executes `runWrapped`** for pi through a
      real spawn: `wrapper.unit.test.ts` only exercises the helpers the module
      exports and never calls it. Mocks stop at the boundaries above the spawn
      (config, path choice, mode resolution, plugin upkeep, the shell-rc offer);
      the spawn, the executable on PATH, the session reader, the transport and
      the socket are all real.
- [x] 16.2 a capture that cannot reach the server leaves the session running —
      pi's own exit code 42 comes back through a refused post, with a live-endpoint
      control run **in the same test** so the failure is a real capture failing
      rather than a capture that never ran
- [x] 16.3 the command exits when pi exits — proven against a server that accepts
      the connection and never answers, which is the shape that actually wedges a
      shell (a refused connection fails fast and proves nothing here)
- [x] 16.4 both scenarios bound, titles byte-compared against the spec
- [x] 16.5 spec — both tags stripped (`:264`, `:270`)
- [x] 16.6 run it, green — 2 tests, 6.06s, 19:00 UTC 2026-09-14, through
      `pnpm --filter langwatch test … --run`. Snapshot: several agents were mid-
      falsification in this tree at the time.

**Both properties are absences, so both carry a positive control.** An exit code
that survives is indistinguishable from a capture that never started, and a
command that exits is indistinguishable from one that never had a timer. So the
undelivered count reported on stderr is compared against the record count the
live endpoint actually received — 127 either way, the same session — and the
poll's existence is asserted before its `unref` and its `clearInterval` are.

**`process.exit` makes the obvious version of 16.3 vacuous.** `runWrapped` ends
in an unconditional `process.exit(exitCode)`, so "the process terminated" passes
with the timer left referenced and uncleared. The only way the command stays
alive is by never reaching that line, and the one thing between the child's exit
and it is the awaited final sweep. That is why the black-hole server is the test
and the refused port is not: **removing the 5s abort in `postOtlpBody` hangs the
run and the test fails on a 15s timeout**, which is the user's shell wedged.
`unref` and `clearInterval` are asserted beside it because they are what would
hold the loop open the day that exit is ever softened, and they redden
separately — with `unref` gone the handle is still referenced at exit; with
`clearInterval` gone the handle never reaches it (the timer still shows
`_destroyed: true`, because the test harness cleaned it up, which is exactly why
the referenced check alone does not cover this one).

**Seven falsifications, each watched red, each restored to a byte-identical
file** (sha256 re-checked after every one):

| Break | Red on |
|---|---|
| capture block disabled (`tool === "pi"` never true) | both tests — `expected 0 to be greater than 0`, and `expected [] to have a length of 1` |
| `process.exit(exitCode)` → `process.exit(0)` | `expected +0 to be 42` |
| `harvest` rethrows a failed post | `expected null not to be null` — nothing is held, so nothing is reported |
| …and the wrapper's guard on the final sweep removed | `TypeError: fetch failed … ECONNREFUSED` escaping into the session |
| 5s post abort removed | `Test timed out in 15000ms` |
| `piPoll.unref?.()` removed | `stillReferenced` holds a `Symbol(refed): true` handle |
| `if (piPoll) clearInterval(piPoll)` removed | `expected [] to include Timeout {…}` |

**The wrapper's `try`/`catch` is the live guard, not pi-capture's.** Making
`harvest` rethrow left the exit code at 42 — the wrapper swallowed it — and only
reddened the reporting assertion. Removing the wrapper's catch as well is what
put a raw `ECONNREFUSED` into the user's session. Worth knowing which of the two
is load-bearing before anyone tidies either away.

**The parity gate was self-checked rather than trusted.** Corrupting one
annotation title took the pi file from `28/28 bound` to `27/28` and named the
scenario, so the gate does read this package's tests and the binding is really
counted. Restored and re-run at 28/28.

**Not proven here:** the interactive-shell branch of the spawn. `SHELL` is
cleared so the deterministic direct-spawn branch runs. pi's capture block sits
above that branch and is identical on both, and `wrapper-shell-reapply.integration.test.ts`
covers the `$SHELL -i -c` side.

**Collision, recorded because it cost a restore.** rung 15 and this rung were
falsifying `wrapper.ts` in the same seconds. One of my restores came back with a
hash that was not the baseline and the file carried rung 15's `// BREAK F6`
marker. Neither agent's evidence from that window is trustworthy on its own; all
seven breaks above were re-verified against a baseline hash taken immediately
before the edit. Two agents falsifying one file at once needs a lock, not care.

## Rung 17 — capture writes nothing and modifies nothing

- [x] 17.1 new `governance/__tests__/pi-readonly.unit.test.ts`
- [x] 17.2 the whole launch path writes nothing — **observed against the filesystem, not against a list of writer mocks.** Real `runWrapped("pi", [])` runs inside a sandboxed HOME and working directory seeded with every file the other tools' writers target (`.zshrc`, `.bashrc`, fish config, `~/.claude/settings.json`, `~/.codex/config.toml`, opencode's jsonc, VS Code user settings, pi's own install, `AGENTS.md` and `CLAUDE.md` in the checkout). The whole tree is hashed before and after — content, size, inode, mtime, ctime, mode — and only the command-line tool's own `~/.langwatch/config.json` may move. The one boundary stubbed is the child process; the mode resolver, `shell-rc`, the plugin updater and the config writer all run for real, because mocking any of them makes "writes nothing" true of the mocks
- [x] 17.3 the session file is byte-identical after capture — a current-version (`version: 3`) file, driven through the real `createPiCapture(...).harvest()`, asserted on content hash **and inode and both timestamps**. The harvest is asserted to have posted events first: "unchanged" is trivially true of a pass that found nothing
- [x] 17.4 both scenarios bound; each title byte-compared against the spec, and each binding watched go red on its own by corrupting one character
- [x] 17.5 spec — both tags stripped (`:276`, `:282`)
- [x] 17.6 10/10 green; feature parity reports 31/31 bound on the pi file

**No shell function is written for pi, and two separate things stop it.** The rung was written expecting one. `SHELL_FUNCTION_TOOLS` is the first and the obvious one — pi is off it, so `resolveWrapperMode` never calls `refreshScopedShellFunctions` and `buildShellReapply` emits no `unset -f pi`. The second is not obvious and lives in another module: `maybeOfferIngestionShellRcPersist` writes a scoped `<tool>()` function for **any** tool that falls through its tool-specific branches, pi included, and what stops it is `shell-rc.ts:390` returning early on an empty env block. pi's block is empty by decision (v9), so the thing protecting pi here is a v9 consequence nobody wrote down as a protection. Both are pinned, with their own reds.

**Falsification.** Six breaks, each one line, each restored and the file's sha256 compared against its pre-break value.

| Break | Result |
|---|---|
| `wrapper-mode.ts:495` — route pi into the claude writer branch | **green, and correctly so.** `ensureClaudeProjectTelemetryPin` and `refreshClaudeUserTelemetryEnv` both no-op on an empty vars map, so this break writes nothing. Recorded because it looks like a miss and is not one |
| `wrapper-mode.ts:565` — route pi into the codex `config.toml` writer | red: `[".codex/AGENTS.md (created)", ".codex/config.toml"]`. It caught a **guidance file the test had never heard of**, which is the whole argument for hashing the tree rather than naming the writers |
| `wrapper-mode.ts:591` — route pi into the opencode flag writer | red: `[".config/opencode/opencode.jsonc"]` |
| `shell-rc.ts:65` — put `pi` on `SHELL_FUNCTION_TOOLS` | red on both shell-function assertions: `expected [ 'pi', 'gemini', … ] to not include 'pi'` and `expected 'unset -f pi 2>/dev/null' not to contain 'unset -f'` |
| `otel-env-block.ts:85` — rename `case "pi"` so pi takes the generic block | red on the direct-call assertion only: `expected [ 'pi shell function (~/.zshrc)' ] to deeply equal []`. The launch-path test stays green, correctly — with pi off the tool list, a non-empty block alone does not reach the rc through `runWrapped` |
| `pi-session-stream.ts:174` — the reader opens `r+` and touches the file | red on the byte-identity assertion, on **timestamps alone**: same sha256, same size, same inode, `mtimeMs` and `ctimeMs` moved. A content-only comparison would have called that write a read |

**The detector has its own self-check**, because a tree differ that reports nothing is indistinguishable from one that is broken. It is run against a directory where a file is added, edited, deleted, and replaced by a copy with identical bytes; all four have to be named, and the same-bytes-new-inode case is the one a content hash misses. Separately, the identical launch harness run against `gemini` must report `.zshrc` — without that twin, "pi changed nothing" is equally true of a harness pointed at the wrong directory.

**One thing the rung did not anticipate, and it is a real caveat.** `updateLangwatchClaudePlugin` (`wrapper.ts:685`) runs on **every** wrapped run whatever the tool, by design, and on a machine that has our Claude Code plugin installed it can move files under `~/.claude/plugins` during a `langwatch pi` launch. The scenario's words are "agent plugins … unchanged", so on that machine the letter of it does not hold. It is green here because the sandbox has no plugin installed and `updateEligibility` returns `absent` before anything is written — which is the honest reading of the test, not a loophole in it. Two facts bound the exposure: the write is to our own plugin, not to pi or to anything pi reads, and it only happens for a user who installed that plugin. Flagged rather than fixed: switching it off for pi is a decision about a tool-agnostic housekeeping path, not a rung 17 edit.

## Rung 18 — put pi on all four settings-tile lists

- [x] 18.1 `me/tiles/assistantIcons.ts:19` — pi in `ASSISTANT_KINDS`
- [x] 18.2 same file `:78-87` — pi preset
- [x] 18.3 icon settled: **no asset added.** No pi mark exists in `public/images/external-icons/` and we hold no licence to redistribute one. `iconUrl: null` is an already-supported state (`AssistantPreset.iconUrl: string | null`); `TileIcon.tsx:37` and `AiToolEntryDrawer.tsx:614` both fall through to the neutral `<Bot />` glyph. Reason recorded in a comment at the preset.
- [x] 18.4 `ee/governance/services/aiToolEntry.service.ts:83` — pi in `SUPPORTED_ASSISTANT_KINDS`
- [x] 18.5 same file `:106-109` — `pi: "pi"` in `ASSISTANT_KIND_TO_TOOL_SLUG`
- [x] 18.6 `me/tiles/__tests__/assistantIcons.unit.test.ts` binds `@scenario "The tool tile offers pi"`
- [x] 18.7 `ee/governance/services/__tests__/aiToolEntry.piKind.unit.test.ts` binds `@scenario "A pi policy chosen in the tile is accepted when saved"`
- [x] 18.8 spec — both tags stripped (`:270`, `:276`)
- [x] 18.9 7/7 green; parity gate exits 0 with eight scenarios now bound

**Rung 18 notes.**

Atom 18.1 alone does **not** turn the bound scenario red: `ASSISTANT_OPTIONS` derives from `ASSISTANT_PRESETS`, not from `ASSISTANT_KINDS`, so removing the kind leaves pi still offered in the tile while the save-gate stops accepting it. That split is the exact `claude_cowork` bug already documented at `aiToolEntry.service.ts:71-76`. It is covered by a second, deliberately unbound assertion in the same file.

Atom 18.5 reads the constant rather than driving `resolveToolPolicyOverrides`. Driving the resolver is the `@integration` scenario "A pi policy set in the tile is the one the launcher applies", which is rung 19, not this rung.

Falsification verified independently of the implementing agent: removing pi from `ASSISTANT_KINDS` and from `SUPPORTED_ASSISTANT_KINDS` together turned 3 of 7 red, including both bound scenarios; both files restored byte-identical and the suite returned 7/7.

## Rung 19 — the tile policy is the one the launcher applies

- [x] 19.1 `user.cliBootstrap.integration.test.ts` — a pi tile written to Postgres, read back through `resolveVisibleTilesForUser` → `ASSISTANT_KIND_TO_TOOL_SLUG` → `resolveToolPolicyOverrides`, asserted in the served `toolPolicies` map
- [x] 19.2 bound `@scenario "A pi policy set in the tile is the one the launcher applies"` — opening line, double quotes, title byte-compared
- [x] 19.3 spec — tag stripped at `:306`
- [x] 19.4 **run, green: 4 passed.** The claim that this file cannot be executed here is wrong — see below.

**The unrunnable-test claim was false, and the test ran.** An earlier report said
this file needs testcontainers and a container runtime that this machine does not
have, and left the change typechecked but unexecuted. It needs neither. Postgres,
ClickHouse and Redis are all up natively (5432 / 8123 / 6379), and
`globalSetup.ts:143` switches to native mode the moment `LANGWATCH_TEST_CLICKHOUSE_URL`
and `LANGWATCH_TEST_REDIS_URL` are set — it then creates the database named by
`LANGWATCH_TEST_DATABASE_URL` and runs `prisma migrate deploy` into it, so dev data
is untouched. The one extra thing this worktree needs is `LANGWATCH_ENDPOINT` and
the five other variables `env-create.mjs` validates, which are absent from its
`.env`; without them every file dies at import with `Invalid environment variables`,
which is what a container failure is easy to mistake for. Run on a
branch-specific database (`lw_shiny_zooming_kahn`); 314 migrations applied on the
first pass, ~10s per run after.

**Falsified twice, in the two directions that matter, each restored byte-identical
(sha256 verified on both files).**

1. Removed `pi: "pi"` from `ASSISTANT_KIND_TO_TOOL_SLUG`. Red, and red with exactly
   the silent-permissive shape rung 18 predicted: `expected allowOtelDirect false,
   received true`. The unmapped kind is skipped and the shipped default is served.
   This is the assertion that makes 18.5 checkable by execution rather than by
   reading the constant.
2. Flipped the tile's stored `allowOtelDirect` to `true`. Red, received `true`.
   Without this the first falsification alone leaves it open that the resolver
   returns a hardcoded `false` for pi and never reads the tile at all — pi's
   `allowVk` *is* forced, so a reader has every reason to suspect the other axis is
   too. It is not: the value travels from Postgres.

**The binding was self-checked.** A binding that cannot fail is the failure mode
this ladder keeps hitting, so the annotation was removed and the parity gate
re-run: `24/25 bound`, naming this scenario at `:307` as unbound. Restored,
`25/25 bound`, gate green.

One caveat carried forward: `allowVk` cannot distinguish tile from default for pi,
because `resolveToolPolicyOverrides:536-539` forces it false whatever the tile says.
`allowOtelDirect` is the only axis this scenario can move. The test asserts
`PLATFORM_TOOL_POLICY_DEFAULTS.pi` up front so that a future change making the
default match the tile turns the suite red rather than passing vacuously.

## Rung 20 — register pi across the remaining product surfaces

- [x] 20.1 `terminalView/sessionBanner.ts` — add pi to the banner agent list
- [x] 20.2 `terminalView/TerminalView.tsx` — add the pi banner entry, the one place the compiler helps
- [x] 20.3 `traces-v2/utils/terminalOrigin.ts` — add pi to the service markers
- [x] 20.4 `me/agentIdentity.ts` — add pi to the kind-by-agent map
- [x] 20.5 `ee/governance/services/ingestKeyProvenance.utils.ts` — add pi
- [x] 20.6 `platformIngestionTemplates.seeds.ts` — add pi
- [x] 20.7 walk the site list in issue #8128 by hand and tick each one — the Gates table calls this the weakest rung because the compiler is silent here
- [x] 20.8 typecheck, no new errors
- [x] 20.9 run the traces unit suite, green

## Rung 21 — register pi across the remaining command-line surfaces

Two of the six atoms are refused, and the count in 21.4 is wrong. Rung 5
deferred both refused sites deliberately; nothing since has changed that, and
rung 22 turned one of the two deferrals into an enforced refusal, so writing
them now would make the command-line tool contradict itself.

- [x] 21.1 **REFUSED.** `install.ts` is `langwatch ingest install <tool>`, the
      Path B command whose whole promise is "so a plain `<tool>` run captures".
      pi cannot honour it: pi ships no exporter, so no persisted wiring makes a
      plain `pi` run send anything, and its capture is the wrapper reading the
      session file after the child exits. Adding the slug is also a compile
      error by construction — `buildEnvBlock:268` is an exhaustive switch over
      `SupportedTool` with no default, so a fifth member fails with `TS2366:
      Function lacks ending return statement`, forcing whoever adds it to write
      a `case "pi"`. Both answers available there are wrong: returning the base
      pair prints `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer …"`
      for the user to paste into their shell rc — the same leak rung 22 closed
      at `buildOtelEnvBlock`, but permanent and machine-wide instead of scoped
      to one child; returning `[]` still mints and rotates a real ingest key and
      still prints the live token, for a capture that will never happen. Note
      `install.ts` has its **own** `buildEnvBlock`, so rung 22's
      `exportsTelemetry()` guard does not reach it. The direct-ingestion change
      at v10 (`allowVk:false, allowOtelDirect:true`) does not bear on this: it
      governs where the **wrapper** posts, not whether pi's own process exports.
- [x] 21.2 already done and falsified — `AGENTS` at `context-session.ts:44`
- [x] 21.3 already done and falsified — the both-flags refusal line at `:77`
- [x] 21.4 **the ladder said two; there are three, one done and two refused.**
      - `program.ts:950`, `ingest context --agent` — done. Nothing asserted it,
        so **21.7** below is new work that now does.
      - `program.ts:487`, the `instrument <tool>` argument list — **REFUSED.**
        Rung 22 made `langwatch instrument pi` fail with "ships no telemetry
        exporter, so there is nothing to instrument", bound by
        `@scenario "A tool that ships no exporter cannot be instrumented"`.
        Listing pi in the argument help would advertise a command that refuses
        it by design.
      - The `Coding assistants:` help footer (`program.ts:626-648`) — a third
        site the ladder never named — **REFUSED.** Verified by execution: adding
        the line turns two tests red, `help-footer.unit.test.ts:54`'s exhaustive
        `toEqual` and, decisively, the bound
        `@scenario "The pi command runs but is not advertised yet"` in
        `pi-command.unit.test.ts:91`, which asserts pi appears in no advertised
        name in `--help`, the footer explicitly included. Rung 5's comment at
        the registration says to add it "in the same change that finishes
        capture"; that change also has to strip or restate that scenario, so it
        is not this rung's to make.
- [x] 21.5 rung-21 scope green: 20 files / 224 tests, 16:59 UTC 2026-09-14.
      The whole `src/cli` tree was 251 files / 3271 tests / 0 failures at
      16:52 and could not be re-measured clean afterwards — `otel-env-block.ts`,
      `wrapper.ts` and `wrapper-mode.ts` were being edited by other agents
      during the run, and the same command returned 5, then 1, then 12 failures
      in three minutes, every one of them in rungs 15 / 17 / 22 files.
- [x] 21.6 typecheck delta **zero**. SDK baseline 3 errors at 16:51, all in
      `pi-wrapper-capture.unit.test.ts`; 6 at 16:59, the 3 extra in that same
      file plus `pi-readonly.unit.test.ts:344`. No error in any rung-21 file, at
      either measurement. **Both files belong to rungs 15 and 17 and will fail
      CI's `typecheck:all`** — flagged, not fixed, because they are in flight.
- [x] 21.7 new, not in the ladder: `__tests__/declare-agent-option.unit.test.ts`
      ties `AGENTS` to the `--agent` prose it is copied into. The two were an
      unguarded hand-copied pair — the set is covered by `context.unit.test.ts`,
      the prose by nothing — so the next agent added to one and not the other is
      refused by a message that does not name it. Falsified three ways: drop pi
      from the prose (2 red), name an agent the set refuses (1 red), break the
      splitter so the comparison would go vacuous (canary red). `AGENTS` is now
      exported; the import is test-only, so the CLI boot graph is untouched.

**What this rung leaves for whoever finishes capture.** The footer line and the
un-hiding of `langwatch pi` are one change with the scenario edit, not three
separate ones. Do not add the footer while the command is hidden and that
scenario stands — `help-footer.unit.test.ts` separately requires every footer
name to be a registered hidden command, so the pairing itself is fine; it is the
"not advertised yet" scenario that has to go first.

---

## Rung 22 — unplanned: pi must be handed no telemetry credentials

Not in the original ladder. Found by the convention scan during review, confirmed
by execution, and it reverses a decision the ADR stated and rung 2 had already
encoded as a passing test. ADR Revision v9.

- [x] 22.1 `otel-env-block.ts` — `case "pi": return {}` in `buildOtelEnvBlock`, the only tool with an empty block, with the reasoning recorded at the case
- [x] 22.2 same file — comment at the `pi` slug saying the table names source types and is **not** a list of tools that export, which is the conflation that caused this
- [x] 22.3 same file — `exportsTelemetry()` and `instrumentableTools()`, derived from the env block so no second hand-kept list can drift
- [x] 22.4 `instrument.ts:56-75` — refuse a tool that ships no exporter, pointing the user at `langwatch <tool>` instead; error text now lists the derived set rather than the raw slug table
- [x] 22.5 **corrected rung 2's test.** `wrapper-mode.unit.test.ts` asserted the token *was* handed to pi's child. It now asserts the block is empty and that the token appears nowhere in it, with a comment saying what the earlier reasoning missed
- [x] 22.6 new `__tests__/pi-no-otel-env.unit.test.ts`, 8 tests, binding `@scenario "The pi child process is handed no telemetry credentials"` and `@scenario "A tool that ships no exporter cannot be instrumented"`
- [x] 22.7 spec — two scenarios added at `:213-227`, both `@unit`, both bound
- [x] 22.8 falsified: removing the `case "pi"` turned 5 of 8 red, including the assertion that the token does not appear; restored byte-identical, 8/8 green
- [x] 22.9 no regression: governance + cli unit suites **970/970 pass**

**Why this was not caught earlier.** The reasoning in the ADR and in rung 2 was
that pi ignores vars it does not read, which is true and irrelevant — the child's
environment is not pi's alone. `wrapper.ts:707` merges the block into the child
env and `buildShellReapply` (`wrapper.ts:296-312`) re-exports it into the
interactive shell, so anything the developer runs inside `langwatch pi` inherits
a live ingest token. Verified by spawning a real child and observing the token.
pi was also shown to be indistinguishable from a typo'd slug — both took the
`default` branch and got the same two keys.

**One pre-existing failure, not ours.** `src/cli/__tests__/feature-map-drift.unit.test.ts`
cannot resolve `internal/generated/cli/feature-map.generated`. Confirmed identical
on a stashed clean tree, so it is a missing codegen artifact in this worktree, not
a regression from this work. It is the same drift test rung 5 and Revision v7
already name.

## Wave C landed — rungs 18, 20, 9

All three verified. Spec now at **14/14 bound**, up from 8/8: rung 9's four cost
and ordering scenarios had their `@unimplemented` stripped after their titles were
matched byte-for-byte, plus the two from rung 22.

**A claimed defect, refuted.** rung 20 reported an empty-trace-id defect in
`canonicalLog.ts:374-427` and named it the thing to fix next. rung 18 declined to
endorse it, saying they had not opened the file. rung 18 was right to withhold.

The mechanism is real: pi resolves to `providerKind: "generic"` (`:372-377`), falls
through both the claude_code and codex synthesis branches, and returns
`{traceId:"", spanId:"", source:"none"}` at `:427`. The severity is not. Checked
downstream, which the report had not:

- `contributions.ts:78-80` — `traceId: z.string().nullable()`, "null when none resolved". Null is the designed value.
- `codingAgentLogFactsDispatch.subscriber.ts:105-107` — the dispatcher maps source `"none"` to null deliberately.
- `:113` — `sessionId = sessionKey ?? correlationTraceId`. pi always carries a session key (rung 9 emits nothing for a file without a session header), so pi never hits the `sessionId === null` return at `:119`.
- `derivation.ts:924-941` — the fold takes attributes, agent, occurredAtMs. It is never handed a trace id at all.

pi's capture is unaffected; nothing drops. The one real consequence is narrower:
`logTraceContributionSchema:92` excludes `"none"`, so pi logs never become trace
contributions and pi rows will not stitch into a trace view. That is ADR-132's
own events-only decision, with spans deferred to #8130 — the accepted gap
rediscovered from the other end, not a new finding.

- [x] C.1 rung 18 — settings tile, `ASSISTANT_KINDS` + preset (`iconUrl: null`)
- [x] C.2 rung 20 — four surfaces: `sessionBanner.ts`, `TerminalView.tsx`, `terminalOrigin.ts`, `agentIdentity.ts`; four test files extended, all falsified
- [x] C.3 rung 20 caught a real trap in the atom list: `CODING_AGENT_SERVICE_MARKERS` is matched by substring, so adding `"pi"` there turns `my-api`, `spider`, `pipeline-worker` into terminal sessions and reddens a pre-existing test. They added a separate whole-name list instead. The atom as written was wrong.
- [x] C.4 rung 20 refused atom 5 correctly — `PLATFORM_INGESTION_TEMPLATES` is still `[] as const` and the `:71` site is an archive list for rows earlier seeds created; pi never had one, so adding it archives nothing
- [x] C.5 rung 9 — `pi-turn-events.ts` + 10 tests, six falsifications, final sha256 matching the pre-falsification copy
- [x] C.6 rung 9 corrected the brief: it said follow codex's payload shape, but `agents/pi.ts:32` is `logsOnly: true` and the fold gates on that from both sides, so pi emits `resourceLogs`, not `resourceSpans`. Following the brief would have produced a payload the pipeline reads for identity and folds nothing from.
- [x] C.7 rung 9 refused to bind two scenarios: "Measurements pi never reports are left blank" is vacuous at builder level (passes with the builder deleted, needs a projection-level read), and "Capture sends events and no spans" belongs to the rung that owns the POST. Both correct. **Do not let a later rung bind either one here.**
- [x] C.8 `agents/pi.ts` — added `logsRequireSessionKey: true`. Documented intent, not a fix: pi's trace fallback is already null so a keyless record drops either way. Keeps holding if pi ever gains a wire trace id.

**Two measurement caveats to carry forward, both stated by rung 9 rather than hidden.**
The clock gap is worse than the ladder said: on the real 132-row file the message
clock trails the entry clock by up to **123,511 ms**, not milliseconds. Entry ISO
clock is used everywhere, pinned by a test on a row where the two differ by 6,017 ms.
And **0 of 69** tool-result rows carry usage, so there is no ground truth on this
machine for any tool-level measurement; none is asserted.

**One open question rung 9 raised and did not decide.** One event per row means
`responseChars` and `apiErrors` both stay 0 for every pi session, even though 33 of
43 assistant rows in the measured session ended in `stopReason: "error"`. A second
event per assistant row would recover both counters but break the five-rows-five-events
reading of the ordering scenario. Not yet decided.

**Process finding worth keeping: biome does not lint `sdks/typescript`.** rung 9
probed it with deliberately bad code and biome stayed silent. The SDK lints with
eslint (`lint: eslint .`), which they verified fires on that path before running it
clean. "biome clean" on an SDK file means nothing.

## Final verification, run once at the end

- [ ] V1 zero scenarios in the pi feature file still carry the not-yet-built tag
- [ ] V2 the feature file no longer appears anywhere in the parity script's exemption list
- [ ] V3 the parity check passes
- [ ] V4 every one of the 33 scenarios resolves to a real test, counted, not sampled
- [ ] V5 each binding annotation sits on the opening line of its comment, in double quotes — the three ways a binding silently passes while enforcing nothing
- [ ] V6a typecheck the app, error count matching the baseline exactly
- [ ] V6b typecheck the command-line package **separately**, by its own compiler run

V6 was wrong as first written and rung 6 caught it. The repository-wide
typecheck command only covers the web app. It never compiles the command-line
package, which is where most of this work lives — the launch path, the session
reader, the transport, the command registration. Running only the first one and
calling it verified would have proven nothing about the majority of the change.
Both runs are required, and the second is the one that matters here.
- [ ] V7 the whole command-line unit suite, green
- [ ] V8 the app unit suites touched by this work, green
- [ ] V9 the nineteen registration sites walked by hand against issue #8128
- [ ] V10 the reorder guard fails when pi is moved off the end of the registry, checked by moving it
- [ ] V11 the drift test fails when one copy of the tool list is edited, checked by editing it
- [ ] V12 nothing outside pull request #8139 and branch `worktree-shiny-zooming-kahn`

### A binding annotation can bind nothing, silently

Found in the ruthless review, by the convention refuter, and confirmed by
falsification rather than by reading.

A `@scenario` annotation only binds when it CLOSES its own comment — either the
one-line `/** @scenario "..." */` form, or as the last line of a block with the
`*/` on that same line. Left on its own line inside a longer block, with the
`*/` on the next line, it binds nothing and the checker reports nothing.

The mechanism is documented in the checker itself, at
`platform/app/scripts/check-feature-parity.ts:1151`: `isFollowedByTestCall`
walks forward from the end of the match and cannot leave a comment it starts
inside. An annotation on its own line leaves the walk pointing at the `*` of
the closing delimiter, which is not whitespace, not a block comment and not a
line comment, so the walk falls through to the test-call match and fails.

Why this is worse than an ordinary mistake: the failure is silent in both
directions. The annotation is not counted as a binding, and it is also not
reported as an unknown or malformed annotation. A green parity run is
therefore not evidence that a given test binds a given scenario. The scenario
may be bound by something weaker elsewhere, and the test the author wrote
specifically to catch a gap is credited to nothing.

Proof, not assertion. Corrupting the title of the offending annotation to a
string matching no scenario left the run at exit 0 with no diagnostic. After
moving the `*/` onto the annotation's line, the same corruption failed the run
with `1 unknown annotation(s)` naming it. Same corruption, opposite outcome —
that is the difference between a parsed annotation and an invisible one.

One instance existed in this change, at
`pi-wrapper-capture.unit.test.ts`, on the wrapper-level lineage test. It is
fixed, and the reason is recorded in the comment so it is not reformatted back.

**71 more exist elsewhere in the repository** and are out of scope here: they
predate this change and sit in directories this ADR does not own. Worth a
ticket of its own, together with the obvious guard — the checker knows the
annotation text matched and knows the walk failed, so it could say so instead
of dropping it.

### Resume billed every earlier turn again — fixed, ADR v11

A refuter sent to kill this claim confirmed it instead, and the lead reproduced
it in the real path before writing the fix.

The reader's seen-set is memory and dies with the process. A resumed session's
file has a modification time that moved, so the file-level window admits it, and
the fresh process starts at row zero — so run N re-sent every turn the session
had ever held. Nothing downstream removes the repeat. The near-miss:
`recordId` is a content hash and both commands stamp
`idempotencyKey: tenantId:recordId`, so a re-read would collapse it — but the
session fold sets `refoldOnOutOfOrder: false` (`codingAgentSession.foldProjection.ts:282`)
because its accumulators commute, so it never re-reads, and `dropAlreadyApplied`
filters on `event.id`, not the key. Sums commute; they do not de-duplicate.

Measured: two captures against one growing file gave `costUsd 1.43 / modelCalls 6`
through the real reducer where the truth was `1.10 / 4`. Unbounded — once per run
touching the session, inflating upward, which reads as real spend.

Fix: capture keeps only turns at or after the run's start, filtering on pi's
entry clock, which every emitted event already carries (a row without a usable
one is dropped at `pi-turn-events.ts:353`, so the filter has no fallback to get
wrong). Nothing on disk, so the "memory, not storage" decision stands. The
rejected alternative was persisting the cursor per session, which works and
contradicts that decision for a problem the clock already answers.

Accepted cost: a turn written before the run started is never captured, so a
crashed wrapped run's unposted tail is not recovered by resuming. That is this
module's existing position on a crash.

- [x] Filter in `pi-capture.ts` `harvest()`, with the reasoning in the comment
- [x] Spec scenario "Resuming a session does not charge its earlier turns again"
- [x] Bound and falsified — neutered, run two sends four turns where two are new
- [x] Three test files carried fixtures frozen at a fixed past instant while the
      wrapper's window starts at `now`; rows are now stamped when written, and
      the real 132-row fixture is rebased onto the run in the integration test
- [x] 1003 tests green across 69 files, parity 35/35, `tsc --noEmit` clean
