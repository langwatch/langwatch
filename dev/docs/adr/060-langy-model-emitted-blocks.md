# ADR-060: The model's in-stream data channel — derived cards and choice questions, stamped by the relay

**Date:** 2026-07-22

**Status:** Accepted (design; implementation not started)

**Builds on:** ADR-059 (card selection is deterministic — §5 sketched the
model's typed-data channel this ADR now specifies), ADR-059 (event-sourced
Langy frontend — the durable event stream these blocks must live in), ADR-058
(turn lifecycle — which this ADR deliberately does not extend).

**Specs:** `specs/langy/langy-derived-cards.feature`,
`specs/langy/langy-choice-questions.feature`.

## Context

ADR-059 (card determinism) settled who decides presentation: a pure function
at the command boundary, never the model. It also named what the model was
left without — any legitimate channel to contribute *data* to a card — and
sketched one (`langwatch present`) that was never built, with the amendment
correcting the record.

Two needs have since become pressing:

1. **Model-shaped views of data the platform holds but does not compute.**
   "Plot this dataset's two columns against each other" has no answering
   command: the dataset card is a table, `analytics query` charts only
   platform metrics, and AGENTS.md rule 20 currently — honestly — instructs
   the agent to say the view can't be drawn. The data is right there; the
   product refuses the picture.
2. **A real UI for the one question the agent is allowed to ask.** AGENTS.md
   rule 3 bans offering options, with one standing exception: a choice that
   spends the customer's money or picks what gets tested is the user's, not
   the agent's ("which agent should this scenario run against?"). Today that
   exception is exercised as a line of prose and a typed reply — the worst
   possible ergonomics for the interaction the rules most explicitly bless.

The transport question has a live reference point. Claude's own surfaces
(artifacts, streamed tool inputs) do not use API-level structured outputs for
this; they parse **generated JSON on the fly**, tolerantly, as it streams.
ADR-059 already catalogued why API structured outputs are the wrong tool for
a presentation channel (enum-casing escapes, refusal/max_tokens holes); this
ADR adopts the streaming-JSON transport — with the one scar this codebase
carries kept firmly in view: the panel once parsed prose sentinels to drive
UI, and removing that was fixing a category error. The line that keeps this
channel on the right side of that scar:

> **Transport-tolerant, boundary-strict.** Salvage the JSON as leniently as
> engineering allows; validate the salvaged result against a fixed schema at
> ONE decision point; let every consumer inherit that one stamped decision.

## Decision

### 1. Transport: a fenced block in the prose, stamped by the relay

The agent emits a fenced block inside its ordinary reply text:

````
```langy-card
{ "kind": "timeseries", "series": [ ... ] }
```
````

The **relay** — the same server-side seam that already owns the turn's frame
stream — extracts the block, salvages its JSON, validates it against the
block kind's schema, and emits it as a **typed part** in the durable event
stream, exactly as tool results already travel. The browser never parses
fences out of text; time travel replays the same stamped part; the event log
is the record. This is ADR-059 §1's "one decision point", applied to a second
entry path.

Structurally, only assistant-generated stream parts are scanned for fences.
Tool results are distinct typed parts and are never parsed for blocks — not
as a defense setting, but as a property of where the parser sits.

### 2. Salvage is aggressive; validation is strict; both are shared

Syntactic repair (unclosed brackets and strings, trailing commas, a
truncated stream) is as tolerant as we can make it. The repaired document
must then pass the block kind's Zod schema **strictly** — a payload that
parses but does not validate is a failed block, never a guessed card.

The block schemas and the salvage function live in the **shared package**
(`packages/langy`), for the same reason the fold reducers do: the client
previews with the SAME code the relay stamps with, so the two runtimes
cannot disagree about what a block means.

### 3. The kinds are a derived-safe allowlist

The model may emit: a **timeseries**, a **generic table**, **key-value
stats** — kinds that are pure presentation of supplied data — and a
**choices** block (§6). It may never emit resource-shaped kinds (`traces`,
`evalRun`, `resourceCreated`, …): a model that can emit a traces card can
assert records that were never searched for. This answers ADR-059's open
question conservatively.

### 4. Provenance chrome is always on, and computation still belongs to the platform

Every model-emitted card renders in visibly distinct "derived" chrome. A
derived number must never pass as a measured one (ADR-059 §6) — the chrome is
the enforcement, styled once in the card frame, not per-card. This is also
the v1 injection posture: with only structural fence-scanning (§1) as
transport defense, the chrome guarantees a spoofed or model-confused block
can at worst produce an obviously-derived card with no model-authored
affordances (§5). Two hardenings are named and deferred, not rejected:
stripping fences from tool output before the model reads it, and a per-turn
nonce in the fence tag.

The rule 20 division of labor stands: if a command can compute it, the
command must ("cost per day" is `analytics query`, never a hand-summed
block). The blocks carry data the platform holds but does not compute —
dataset columns, model-derived groupings — and the prompt rule that draws
this line gets a dogfood eval, per ADR-050's obligation that prompt-resting
behavior is evaluated, not assumed.

### 5. Affordances are hinted by the model, bound by the platform

A block may carry affordance **hints** from a closed vocabulary. A hint is a
request: the platform validates it and binds the actual control, or drops
it. The model never authors a URL, an action, or a component. v1 vocabulary:

- **`explore`** — a filter/query for the Trace Explorer. Rendered only if it
  validates against the real field catalogue (the seam Langy's explorer
  handoff already uses); an invalid query renders no link, silently.
- **`verify`** — the derived-vs-measured bridge: the card offers "run this as
  a real analytics query", replacing model-copied numbers with
  platform-computed ones in one click. The verified result arrives as an
  ordinary measured card through the existing envelope path.

### 6. Choice questions: the `choices` block

`{ question, options: [{ id, label, description?, ref? }], multiSelect?,
allowOther? }` renders as a selectable card. Decisions:

- **The question ends the turn.** No new phase in the ADR-058 machine, no
  parked worker. The agent asks as the tail of its reply; the turn settles;
  the selection arrives as the next user message. Stop, resume, refresh and
  replay all work unchanged because nothing about the turn lifecycle changed.
- **A selection is an event and a message.** It enters the durable log (the
  card renders its chosen state from the fold, forever, including in time
  travel) and reaches the agent as a user message carrying a typed part
  (`{ blockId, optionIds }`) plus a plain-text rendering — the UI binds by
  id so adjacent questions can't misroute; the model just reads text.
- **Entity refs are hydrated as the viewer.** An option may carry
  `ref: { type, id }`; the platform resolves it through the existing
  id-reference hydration seam. Live entities render as rich rows; a dead ref
  renders disabled ("no longer exists") — the model cannot make the user
  select a thing that isn't there, and hydration-as-viewer keeps it
  permission-true.
- **Any later message locks the question.** A choices card is answerable only
  while it is the conversation's latest exchange; anything after it renders
  it superseded (grayed, unclickable). Pure event-order derivation — no
  timers, no wall-clock state the fold can't replay.

This block is the sanctioned UI for AGENTS.md's existing user-decision
exception. The prompt rule ships with the implementation, not before it.

### 7. Progressive rendering, with the settled part as truth

Blocks render **progressively from day one**: the client repairs the partial
JSON per chunk and previews the card as it forms — through the same shared
validation the relay will apply (§2), so a preview is only ever shown for
data that already validates. At settle, the relay's stamped part reconciles
the preview **by block id**; on any disagreement the settled part wins —
the same server-clock rule the text merge already follows. The durable log
carries only settled parts: previews are a live-stream affair, exactly as
the ephemeral token stream already is.

### 8. A failed block renders as a disclosure, never silently

A block that cannot be salvaged, or fails validation, renders as a collapsed
one-line disclosure ("Langy tried to draw a chart here — view raw") that
expands to the raw fenced text. Never a guessed card, never silent removal
of content the model produced — a failure may never be quieter than a
success. Salvage and validation failures are counted, like ADR-059's probe
misses: that counter is the drift alarm for prompt regressions in block
emission.

## Rationale / Trade-offs

**Why in-stream rather than `langwatch present`.** The CLI command remains
the most attributable transport (a visible tool call), and §5 of ADR-059 is
not repealed — but a card that cannot sit mid-sentence, costs a shell
round-trip, and cannot stream its build-up serves the reply-flow use badly.
The relay stamp preserves what `present` would have bought — schema
validation at a boundary the model doesn't control — while keeping the
prose-woven ergonomics. `present` may still arrive later for agent-initiated
cards outside a reply; nothing here precludes it.

**Why the question ends the turn.** Suspend-and-resume is strictly more
seamless and strictly more machinery: a new phase state, a parked worker (or
checkpoint/restore), a timeout policy for humans who never answer, and Stop
semantics for a turn that is neither running nor done. The end-the-turn
shape gets the entire feature for the cost of one message round-trip, on an
agent that already pays cold-turn costs routinely. Revisit only if real
usage shows the context re-read hurting.

**What we give up.** A tenant fence quoted by the model can still reach the
parser in v1 (the deferred hardenings close that); the answer is that the
blast radius is bounded by construction — derived chrome, no model-authored
affordances, allowlisted kinds — to "an obviously-derived card the user can
ignore". And progressive preview adds real client complexity; the shared
validator is what keeps it from adding a second truth.

## Consequences

- `packages/langy` grows the block schemas, the salvage function, and the
  preview reducer — shared, like the folds, so relay and browser cannot
  drift.
- The durable event stream grows part kinds for stamped blocks and choice
  selections; the capability catalog/registry grows renderers for the
  derived kinds and the choices card. Rendering stays registry-driven —
  these are new entries, not new conditional paths.
- Time travel inherits fidelity for free: stamped parts and selection events
  replay through the same fold as everything else.
- AGENTS.md changes (rule 20 gains the block instruction; rule 3's exception
  points at the choices block) ship WITH the implementation and carry a
  dogfood eval each.
- `specs/langy/langy-capability-cards.feature` remains the panel-rendering
  spec; the two new feature files own the channel and the choices card.

## Open questions

- The deferred injection hardenings: strip fences from tool output the model
  reads; a per-turn nonce in the fence tag. Adopt when the channel carries
  affordances beyond the v1 vocabulary, or earlier if abuse is observed.
- Whether a derived table needs pagination or a row ceiling (a model can
  emit an unbounded table; the card should probably cap and disclose).
- Rate/size limits per turn (N blocks, M bytes) — a runaway loop emitting
  cards is a new failure mode the relay should bound.
- Whether `verify` hints should carry the mapped analytics query explicitly
  or let the platform derive it from the card's own series metadata.

## References

- ADR-059 (card determinism) — §5 typed channel, §7 bounded hint, amendment
  on `present` not existing.
- ADR-059 (event-sourced frontend) — the durable stream and shared-fold
  architecture these parts ride.
- ADR-058 — the turn lifecycle deliberately left unchanged by §6.
- ADR-050 — prompt registry and the eval obligation for prompt-resting rules.
- Anthropic — structured outputs and the documented limits of the guarantee:
  https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- OWASP LLM01, prompt injection (2025):
  https://genai.owasp.org/llmrisk/llm01-prompt-injection/
