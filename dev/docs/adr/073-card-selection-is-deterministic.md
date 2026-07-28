# ADR-059: Card selection is deterministic — the model supplies data, never presentation

**Date:** 2026-07-21

**Status:** Accepted (amended 2026-07-22 — see "Amendment: one decision point,
enforced" for what shipped and what turned out to be wrong)

**Builds on:** the `@langwatch/langy/cards` contract (one card per result
*shape*, shared by the CLI and the Langy panel so the two can never disagree
about what a command produced), and the capability catalog / registry that binds
a view to each CLI resource.

> **2026-07-22.** This contract used to be its own package, `@langwatch/cli-cards`.
> It now lives at `packages/langy/src/cards` and is imported as
> `@langwatch/langy/cards`, so that the measured cards described here and the
> derived cards of ADR-060 share ONE kind list instead of two vocabularies that
> mirrored each other. Paths below are given in their current form.

**Spec:** `specs/langy/langy-capability-cards.feature` (to be extended alongside
this decision).

## Context

Langy renders a CLI result as a rich card — traces, metrics, a dataset, an eval
run — and the card is chosen from the command's **name**:

```ts
// packages/langy/src/cards/tool-result.ts
export function toCliToolResult({ resource, verb, payload }) {
  const card = cardKindFor({ resource, verb });   // name only
  const parsed = schemaByCard[card].safeParse(payload);
  if (parsed.success) return { kind: "card", card, payload: parsed.data };
  return { kind: "json", payload };               // soft-fail to a raw receipt
}
```

Two things about that function matter more than they look.

**It is the single decision point.** The transport is a discriminated union
carrying an explicit `card` field, stamped once here at the command boundary. The
event log, the Redis live edge, the browser and the CLI's own terminal rendering
all inherit that one decision. Nothing downstream re-decides.

**It already holds the payload, and ignores it.** The choice is made from
`resource` and `verb`; `payload` is only used to *validate* the pre-chosen card.
So a result can arrive full of summable cost or a chartable time series and still
render as a generic table because of what the command was called.

That is not hypothetical. `traceSummarySchema` names `input`, `output`,
`timestamps` and `error` — but not `metrics`. It is a `looseObject`, so real
`trace search` output carries `metrics.total_cost` per trace straight through
parsing, and the card never reads it. **The data to answer "what did this
filtered view of traces cost" is already on the wire, and we drop it.**

The question this ADR answers is what should fix that. The obvious modern answer
— let the model decide which card to render, or have it generate the UI — has to
be taken seriously, because this product has a specific reason to distrust it and
a specific reason to want it:

- **The reason to distrust it.** The panel was previously steered by parsing the
  model's prose: a `[langy:connect-github]` sentinel drove the connect card, and
  any PR URL in a reply drew a PR card. Both are gone. The comments left behind
  in `MessageContent.tsx` name the category error exactly — we asked an LLM to be
  a reliable state machine in text, then parsed the text to drive UI.
- **The reason to want it.** Langy's agent has **no typed tool channel**. It runs
  the `langwatch` CLI through a shell. There is no "model calls typed tool →
  bound component" seam to exploit, so the model currently has no legitimate way
  to influence presentation at all, however sensible its intent.

## Decision

### 1. Card selection is a pure function of `(name, payload)`, decided once

We will keep the decision at `toCliToolResult` and extend it to read the payload.
Anything a pure function can decide will not be decided by a non-deterministic,
network-bound, injectable oracle.

The consequences of purity are the point: the same JSON renders the same card
every time; the decision is replayable from the event log; it is unit-testable
per shape with fixtures; and cards still render when the assistant leg is down.

### 2. Eligibility and ranking, not first-match

Each card declares a Zod **eligibility schema** over the payload. Every eligible
card receives a **specificity score**, and the highest score wins, with ties
broken by an **explicit total order** — never object-key order, which is latent
non-determinism wearing a deterministic mask.

This is not novel and we will not pretend it is. Automated visualisation
recommendation solved "this data shape wants this view" decades ago —
Mackinlay's *Show Me* ranks every eligible view against expressiveness and
effectiveness criteria; UW's *Draco* encodes design knowledge as hard and soft
constraints and returns a ranked recommendation. First-match `if`-chains are the
thing both papers exist to replace.

### 3. The command name is a prior, not a replacement

The name narrows the candidate set; the shape may **promote generic → specific**.
Promotion may never demote, and may never override an explicit `byVerb` mapping —
a deliberate binding (`scenario run` → `evalRun`) always beats an inference.

### 4. A generic card always matches, and misses are logged

The generic resource card remains eligible for everything. That is what makes
registry growth safe: an unrecognised shape degrades to the card it gets today,
never to nothing and never to a wrong card.

Probe misses and fallback hits will be logged. When the CLI's output shape
changes, that log is the drift alarm — the lesson server-driven UI systems
learned the hard way, where an unknown-type fallback plus telemetry on unknown
types is what keeps a client registry honest against a moving server.

### 5. The model's channel is typed data, never presentation

The model may **supply data into a fixed schema**. It may not choose the
component, emit props, or emit prose that becomes UI.

Concretely, we will give the agent the typed channel it currently lacks: a
`langwatch present <cardKind>` command reading JSON on stdin, validated against
that card's schema at this same boundary. It is visible in the tool call, carries
no sentinel, and a schema rejection falls back to the JSON receipt — the
guardrail already exists and is reused rather than rebuilt.

### 6. Computation belongs to the platform; shaping may belong to the model

In an observability product a chart is read as **measured**. A cost-per-day
series that a model summed by hand is a different kind of object from one the
platform aggregated, even when the two agree.

So: the platform computes, the model reshapes and labels. `analytics query`
already exposes `total-cost` as a `sum` aggregation, which means the motivating
example — a trend of cost over time — is exactly computable and must be answered
by querying it, not by asking the model to add up a page of traces.

Where a model-derived number does reach a card, the card must say so. A derived
figure may not pass as a measured one.

### 7. If a model hint is ever added, it is bounded

Should ranking prove genuinely underdetermined, a model hint may **reorder cards
that already passed eligibility**. It may never introduce a card. It will be
validated case-insensitively, treat `refusal` and `max_tokens` as "no hint", and
be cached by payload hash so the same input renders the same card twice.

We are not building this now. It is written down so that adding it later is a
decision against a boundary rather than a drift across one.

### 8. We will not render model-authored components

Not on the card path, not sandboxed, not later.

## Rationale / Trade-offs

### What the industry actually converged on

The systems shipping "generative UI" in production — Vercel's AI SDK, OpenAI's
Apps SDK, MCP Apps, Google's A2UI, CopilotKit — all landed on a fixed,
developer-owned registry in which the model contributes at most a discriminator
and data.

The AI SDK detail is worth stating because the term misleads: *the model picks a
**tool**; the developer binds the **component**.* Its own documentation defines
generative UI as "connecting the results of a tool call to a React component",
and the RSC variant that streams model-chosen UI carries a standing
"experimental — use AI SDK UI for production" warning with concrete defects.
Our name → card binding is therefore the mainstream pattern already; shape-driven
selection is a gap the mainstream has not filled, not a deviation from it.

Anthropic's own surfaces argue the same way. Artifacts are chosen by
content-property heuristics — self-contained, over roughly fifteen lines,
worth reusing outside the conversation — which is a payload-shape test over a
closed type set. MCP Apps pre-declares UI templates as resources referenced from
*tool metadata*, chosen by the tool author, justified explicitly so that hosts
can prefetch and review a template *before* the tool runs — a property that is
unobtainable if the model chooses.

### Why not let the model choose

Three independent reasons, each sufficient on its own:

**Structured outputs are a syntactic guarantee with documented holes, and a
`cardKind` enum is the weakest case for them.** Anthropic's documentation states
that enum casing is not guaranteed, and that both a refusal and a `max_tokens`
stop leave the output outside the schema. Structured outputs would make a model's
card choice *parseable*; they would not make it *correct*.

**Temperature 0 does not buy determinism.** Non-determinism in LLM inference
arises from batch-invariance in reduction kernels — output depends on server-side
batch size, which we do not control through a hosted API. The same command run
twice could render two different cards, which is an untestable UI and a
support-ticket generator.

**Selection accuracy is worst exactly where our cards live.** Tool-selection
benchmarks find the dominant error class is choosing the wrong item, and that
accuracy degrades with catalogue size and with semantic adjacency. Our cards are
adjacent by construction — `spend`, `usage`, `cost-breakdown`, `series`. Worse,
the CLI's JSON is **tenant-controlled data**: routing it into a model that
decides presentation means a tenant can author a record whose *content* steers
which card, and therefore which affordances, a user is shown. A deterministic
probe is also influenceable, but its blast radius is bounded to one of N
pre-vetted, pre-styled cards, and no attacker-authored string ever becomes
component identity.

### What we give up

A model would be better than a ranking function at one thing: choosing between
two *equally* eligible presentations based on what the user actually asked. "What
did this cost?" and "show me the errors" over the same trace list want different
headline cards, and that intent lives in the prompt, not the JSON.

We accept that loss for now, because the model already expresses intent through
the command it chooses to run, and because a `--view` argument on that command is
a cheaper, typed, inspectable way to carry it than a second inference on the
render path. Section 7 keeps the door open without leaving it ajar.

## Does an editable system prompt change this?

ADR-050 moves `AGENTS.md` into LangWatch's own versioned prompt registry so it is
versioned, diffable and **editable without a redeploy**. It is reasonable to ask
whether that makes "just instruct the model to pick the right card" viable after
all. It does not, and the reason is local rather than theoretical.

**None of the three objections above are prompt-addressable.** Enum casing,
refusal and `max_tokens` are escapes from the schema guarantee at sampling time.
Batch-invariance non-determinism is infrastructure — no wording makes the same
input render the same card twice. Selection accuracy under semantic adjacency is
a capability limit, not an instruction-clarity limit.

**And we have already run the experiment.** `AGENTS.md` rule 12 forbids narrating
a tool call and lists, verbatim, the banned opener *"Using the analytics skill
to..."*. Langy emitted *"Using the agent-performance skill to search recent
traces."* The rule was present, specific, and exemplified; it was violated anyway,
and the fix that shipped was deterministic client-side stripping
(`logic/langyToolNarration.ts`). A more editable copy of that file would have
changed nothing — the rule was already right.

What editability genuinely improves is the *other* half of this ADR. Both
`langwatch present` (§5) and a `--view` intent argument (§7) depend on the model
knowing when to reach for them, which is exactly a prompt rule, and cheap
iteration is what makes them practical. Editability therefore strengthens **what
the model contributes** and leaves **who decides** untouched — the same line drawn
throughout.

It also imposes an obligation: any behaviour resting on a prompt rule needs an
eval, precisely because rule 12 proves rules fail silently. ADR-050 pairs the
registry with dogfood scenarios and evals in the same decision, so the mechanism
exists; these rules must actually use it.

Finally, the customer-facing reading points the same way. If a tenant could edit
the prompt that decides presentation, card selection would become tenant-
controlled UI selection — upgrading the injection concern from "tenant *data*
influences the card" to "tenant *configuration* controls it". ADR-050 already
forecloses this (the agent definition is deployment-global; `PromptScope` has no
global tier), but that is currently a consequence of the schema rather than a
stated safety property, and it should be treated as the latter.

## Consequences

- **The CLI's own rendering changes too.** The card contract is shared,
  deliberately, so that the panel and the terminal cannot disagree. A promotion that gives the
  panel a spend card gives `langwatch trace search` one as well. This is intended.
- **The coverage test grows a second obligation.** It currently guards
  catalogue ⟷ CLI-resource parity; it will also need to hold each new card kind
  to an eligibility schema and a place in the tie-break order.
- **Ranking must be tested as ranking.** A test that asserts "this payload gets
  this card" is not enough; ties and near-misses are where a ranked system fails,
  and the probes get tests before the cards do.
- **Adding a card becomes cheap and safe.** A new card is an eligibility schema,
  a score, a tie-break position and a renderer branch. The generic fallback means
  a mis-scored card degrades rather than breaks.
- **We keep one decision point.** Selection stays at the command boundary, so
  every consumer — event log, live edge, browser, terminal — continues to inherit
  a single stamped answer rather than re-deriving one.

## Amendment: one decision point, enforced (2026-07-22)

The decision above shipped, and then did nothing at all. Everything in §1-§4
existed — the probes, the ranking, the timeseries card, the shape mapper — and
no promotion ever reached a screen. Three defects, each of which the ADR as
written did not forbid clearly enough.

**The panel re-decided.** `toCliToolResult` stamped the promoted card into the
envelope, and then the renderer derived the card AGAIN from the command's name
(`cardKindFor`) and required the two to be equal, dropping the call when they
were not. Promotion's defining property is that the promoted card differs from
the name's, so every promotion failed that check and the call vanished from the
capability stream — the mechanism could only ever *remove* a card, never improve
one. "Nothing downstream re-decides" was stated here as a property of the
transport; it was not a property of the code. It is now a rule with a name:
the descriptor is re-seated on the envelope's card (`withDecidedCard`), the
identity check is gone, and reading a payload downstream goes through
`parseCardResult({ kind })` — never a kind re-derived from a command name.

**Eligibility was written as "generic", which is not the rule.** §3 says a
promotion may not override a deliberate `byVerb` binding. `PROMOTABLE_FROM`
implemented that as "the generic read card only", which excluded `metrics` —
the `analytics` resource's DEFAULT read card, chosen by no verb in particular.
`analytics query` is the one command in the product that emits a chartable
series, so the timeseries card was unreachable by construction. Eligibility now
follows the rule as stated: a resource DEFAULT is a prior and may be promoted; a
`byVerb` binding is a decision and may not.

**A registered widget had no branch.** `chart` was in the catalog's widget
vocabulary with no case and no `default` in the declarative card's switch, so it
rendered `undefined`. Both are fixed, and the `default` means the next widget
added to the vocabulary degrades to a plainer body rather than to nothing —
the same "a plainer card always beats no card" rule the card switch already had.

Two corrections to the text above:

- **`langwatch present` (§5) does not exist.** No command emits a card
  directly. The timeseries card is reached the way §6 says it should be: the
  command that knows the question shapes its own answer (`analytics query`
  knows the metric, aggregation and window, and emits `series` alongside the raw
  buckets), and the registry recognises the shape. The comment in `cards.ts`
  claiming a `present` emission path has been corrected rather than left
  aspirational.
- **The consequence "the CLI's own rendering changes too" has not landed.**
  The card contract is shared, but nothing in the CLI renders from the stamped card
  today; the terminal still prints its own table. The claim is a design intent,
  not a current fact.

The gap that let all of this ship green: every link of the chain had a test and
the chain had none. `promotion.test.ts` called `promoteCard` directly, and its
one end-to-end assertion fed `virtual-keys list` a `{ totalCost: 42 }` payload
that command cannot produce (it answers with an array of keys, carrying no cost
at all). The binding obligation is therefore stronger than "ranking must be
tested as ranking": **at least one test must run a realistically-shaped command
payload through the envelope and into a rendered card**
(`LangyCapabilityCardSelection.integration.test.tsx`).

## Open questions

- Whether `langwatch present` should be constrained to a subset of card kinds
  (a model that can emit a `traces` card can assert traces that were never
  searched for).
- How provenance is surfaced on a card whose numbers the model derived — a label,
  a distinct treatment, or refusing the case entirely.
- Whether `--view` on read commands is worth adding now or is speculative until
  ranking is observed to underdetermine in practice.

## References

- Related: ADR-058 (Langy user-initiated turn controls) for the turn lifecycle
  these cards render within.
- Vercel AI SDK — generative UI as tool-result → component:
  https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces ·
  RSC experimental status and defects:
  https://ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui
- Anthropic — Artifacts selection criteria:
  https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- MCP Apps (SEP-1865), pre-declared `ui://` templates:
  https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/ ·
  https://modelcontextprotocol.io/extensions/apps/overview
- Anthropic — structured outputs, and the documented limits of the guarantee:
  https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic — writing tools for agents ("a contract between deterministic
  systems and non-deterministic agents"):
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Non-determinism at temperature 0 (batch-invariance):
  https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- OWASP LLM01, prompt injection (2025):
  https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Google A2UI — declarative UI from a trusted catalog, not executable code:
  https://github.com/google/A2UI
- CopilotKit — the controlled / declarative / open-ended spectrum:
  https://docs.copilotkit.ai/concepts/generative-ui-overview
- Visualisation recommendation as ranked eligibility — *Show Me*
  (Mackinlay, Hanrahan, Stolte, InfoVis 2007):
  https://www.tableau.com/whitepapers/show-me-automatic-presentation-visual-analysis ·
  *Draco*: https://idl.cs.washington.edu/files/2019-Draco-InfoVis.pdf
- Airbnb server-driven UI (discriminator + closed union + client registry):
  https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5

### Evidence quality

Two claims above rest on secondary sources and are marked as such rather than
dressed up: router latency/cost figures for an LLM classifier come from vendor
blogs (the structural objection does not depend on them — card choice is
necessarily serial and post-command), and the unknown-type-fallback and
versioning specifics attributed to server-driven UI are community synthesis
rather than the primary Airbnb post.

More importantly: **no published post-mortem was found of a team shipping
model-chosen components and reverting.** The convergence argument here is
*architectural* — what the protocols permit and what their authors say about why
— not *empirical*. That is a real gap in the evidence and this ADR should not be
read as claiming otherwise.
