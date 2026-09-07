# ADR-129: Pulled spend names its spender, but only from a line forward

Date: 2026-09-06 · Status: **Proposed** · Extends: ADR-128 §9 (raw actor ids on money rows), ADR-122 (OpenAI admin puller)

> One-line: every pulled-usage event gains a **defaulted `rawActorId`**, filled this wave by the **OpenAI and Databricks** pullers where the provider reports a person, and a day is named **only from a per-source line forward** — because a re-read that renames an already-recorded day would land its money in a new rollup cell while the old cell keeps it, counting it twice.

## Context

ADR-128 §9 rules that money rows carry the provider's raw actor id for every
source, and the gateway lane already does
(`governanceCostRollup.foldProjection.ts:300-303`). The pulled lane writes
`rawActorId: ""` (`:277`): the OpenAI admin adapter already reports the
spender (`openaiAdmin.puller.ts:848`) and already carries the user inside its
bucket dimensions (`:802`), but the record layer (`pulledUsageRecord.ts`)
drops the actor before it reaches the event.

The trap is the re-read window. Pullers re-read recent days to catch provider
restatements. The rollup cell key is a 9-tuple that includes `rawActorId`
(`governanceCostRollup.foldProjection.ts:337-355`), the fold keeps per-bucket
state (`state.pulledItems[restatementKey]`, `:619`), and the read side
dedups within a cell then sums across cells
(`governanceCostRollup.clickhouse.repository.ts:229-234`, `:256-264`). So a
restatement that keeps its bucket key but changes the actor (`""` → `u_123`)
lands in a new cell while the old cell keeps its figure — the day's money is
shown twice, and a full replay folds both events into their own cells all over
again. Naming may never change the cell identity of a day that was already
recorded. This bites even OpenAI, whose bucket keys already carry the user:
the actor field on the event is what keys the cell, and today it is `""`.

Confirmed in the framing round (2026-09-06, Sergio): blast radius is
customer-visible money (double-shown spend), and four hard constraints hold —
never guess the spender; no key-to-person linking this wave; ships dark behind
`release_pulled_usage_cost_enabled`; stored history is never edited in place,
only rebuilt by replay.

## Decision

1. **The pulled-usage event gains `rawActorId: z.string().default("")`**
   (`pulled-usage-processing/schemas/events.ts`). Defaulted, not required, on
   the precedent of `currencyCode` (`:88`, defaulted `"USD"`): the log is
   append-only and a required field would make history unreadable (ADR-128
   §3). Rejects a read-time helper à la `readPulledUsageMoney` — `""` is the
   correct legacy value, no disambiguation needed. The fold keeps `""` as-is:
   no read-side rewriting, no backfill.

2. **A day is named only from a line forward, decided by one shared rule.**
   For a source created before `PULLED_ACTOR_NAMING_STARTS_AT`, days on or
   after the line are named; earlier days stay `""` forever, even when
   re-read. For a source created on or after the line, every day is named,
   history included — a fresh source has no old unnamed figures to collide
   with. Decided by comparing `IngestionSource.createdAt` to the constant; no
   new stored field. WHY: this makes the twice-guard structural — nothing ever
   moves cells — and means **no rebuild and no migration**: old events fold to
   exactly the cells they fold to today. Rejects zeroing the old figure on
   re-read (the one mechanism where money doubles if it has a bug) and
   rejects dropping the re-read habit (loses provider restatements).

3. **The named-or-blank rule is one shared helper, called by every naming
   puller.** Sergio's call (over my one-off recommendation, recorded below):
   the line comparison must be identical everywhere, so it is written once.
   The helper decides named-or-blank and threads the value; each adapter
   still supplies the raw actor its own way.

4. **The actor rides the event payload, never the restatement key.** This is
   already the codebase's own rule — the Databricks puller keeps authors out
   of record keys precisely because identity can change between pulls and an
   author in the key would mint a second record
   (`databricksGenie.puller.ts:2544-2548`). Consequence: an adapter never
   changes its restatement keys or dimension buckets for this ADR. Where a
   provider's bucket is coarser than one person (several people inside one
   billing row), that bucket's actor stays `""` — a bucket names a person
   only when the provider itself resolves it to one.

5. **Two pullers this wave; the rest pause** (Sergio's ruling 2026-09-06,
   superseding the earlier "all pullers" call — recorded in Revisions):
   - **OpenAI admin: thread the already-reported actor through**
     (`openaiAdmin.puller.ts:848`). Its bucket dimensions already carry
     `userId` (`:802`), so naming adds no new buckets — only the event's
     actor field changes, under Decision 2's line.
   - **Databricks: surface `executed_by` into the actor payload** for the
     billing-usage rows that carry it (~80% of spend; the Genie lane is $0
     until 2027-01-31). Restatement keys and buckets stay byte-identical
     (Decision 4); rows without a resolvable single person stay `""`.
   - **Anthropic: paused.** The admin usage report structurally has no
     person dimension (`anthropicAdmin.puller.ts:751` — deliberately `""`),
     and the compliance feed's actor is a raw **email address**
     (`claudeCompliance.puller.ts:50`), which we will not put on money rows
     without its own ruling. The no-key-linking constraint forbids deriving
     a person from an API key.
   - **Copilot: paused.** Billing is per seat; money is never itemized per
     person. Per-person usage exists, per-person money does not, and we do
     not invent a split.

6. **The pulled lane routes its actor through `actorIdForRollupWrite`**, same
   as the gateway lane: erasure substitutes the pseudonym at the key, before
   the row is written (ADR-128 §9 step 5). Inherited, not new. Upstream of
   that, the pull path already suppresses events naming an erased identifier
   before they become events at all (`pullerWorker.ts`,
   `partitionSuppressedEvents`).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `PULLED_ACTOR_NAMING_STARTS_AT` | UTC date, set in the release PR; MUST be ≥ the merge date | The line of Decision 2. If set earlier than deploy, days in the gap get pulled coarse by old code then named by new code — the exact double-count this ADR exists to prevent. |
| Legacy actor value | `""` | Blank means "provider didn't say", "bucket coarser than a person", or "pre-line"; never a guess. |

## Invariants

| Invariant | Meaning | How satisfied / test anchor |
|---|---|---|
| Naming never moves money between cells | A restatement folds into the same rollup cell as the figure it corrects | Decisions 2+4; test: pre-line day re-read after the change emits byte-identical restatement keys and cell keys |
| Totals are unchanged by naming | Sum over actors of a post-line day equals the day's lump | Fold test: pull coarse fixture vs per-actor fixture, same total |
| Keys never change | No adapter's restatement key or dimension set changes for this ADR | Decision 4; adapter unit tests on fixture parity |
| Blank is honest | `rawActorId: ""` only ever means unreported, unresolvable, or pre-line | Decision 5; adapter unit tests; no fallback chain anywhere |
| Erased actors never reach a key | Pulled lane substitutes the pseudonym before the write | Decision 6; the gateway lane's existing test pattern, applied to pulled |
| No key-derived people | No adapter maps an API-key id to a person | Anthropic stays paused; code-review gate |
| History readable | Events without the field parse with `""` | Schema unit test on a legacy event fixture |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Provider user ids are stable over time | One person appears as several rows/lines on the cost screen (display problem, not a money problem) |
| A provider's per-user buckets keep their user across restatements | A re-attributed bucket would strand the old figure under the old user (stale name, money still counted once) |
| The erasure suppression list keys on exactly the string adapters emit | An erased person's id would keep landing on new rows (verified: `openaiAdmin.puller.ts:841-844` — suppression and discovery read the same `actor` string) |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| Event schema field (defaulted, additive) | Yes | Large (log contract) | Automated: legacy-fixture parse test |
| Fold cell keying by actor | Yes (code), rows accrue | Large (money display) | Automated: invariant tests above; ships dark behind `release_pulled_usage_cost_enabled` (`registry.ts:165`, FALSE) |
| Databricks billing query change | Yes | Medium (customer warehouse, read-only) | Automated: adapter unit + key-parity test (Decision 4) |
| `PULLED_ACTOR_NAMING_STARTS_AT` value | **No** (wrong value = double count in the gap) | Large | Human review in the release PR: constant ≥ merge date, checked by a named reviewer |
| Rollup rebuild / migration | — | — | **None. Deliberately: nothing to gate — no migration ships.** |

## Schema

No database migration. One event-schema addition:

```ts
// pulled-usage-processing/schemas/events.ts — additive, defaulted (ADR-128 §3)
rawActorId: z.string().default(""),
```

Shared rule (shape, not final code):

```ts
// Named-or-blank, decided once for every naming puller (Decision 2+3).
function actorForPulledDay(opts: {
  sourceCreatedAt: Date;      // IngestionSource.createdAt
  dayUtc: string;             // the business day being priced
  reportedActor: string;      // what the provider said; "" if it said nothing
}): string
```

## Rejected alternatives

- **Zero the old lump on re-read** — names history, but is the one mechanism where a bug doubles money; rejected in the fork round.
- **Stop re-reading old days** — silently drops provider restatements.
- **One fixed line for all sources** — a source connected later gets nameless history for no reason.
- **Per-source stored stamp** — most precise, but buys a schema migration the createdAt comparison gets free.
- **Actor inside the restatement key or dimensions** — mints second records when identity resolution changes between pulls; contradicts the puller layer's own standing rule (`databricksGenie.puller.ts:2544-2548`).
- **Split coarse buckets across their people** — invented numbers; a bucket names a person only when the provider resolves it to one.
- **Guess the person from an API key** — forbidden by standing constraint (keys never affect billed data this wave).
- **Put the compliance feed's email on money rows** — a raw address is heavier than an id (erasure, exposure); paused with Anthropic until ruled.
- **Backfill names onto old rows** — ADR-128 §9 already rejects editing history to match today.
- **Revision inside ADR-128** — offered; Sergio chose a standalone doc.

## Consequences

- Positive: the cost screen answers "who spent this" for OpenAI and most Databricks bills (the #7880 ruling made real); no migration, no rebuild, no rollout risk beyond the dark flag.
- Negative: history before the line stays nameless **forever** for pre-existing sources — bought deliberately as the twice-guard. Anthropic and Copilot money stays nameless while paused, so per-person totals will not sum to the company total; the gap is exactly those providers and should read as "not assignable to a person", not as a bug.
- Neutral: rollup row count grows per-actor for post-line days (bounded by provider-reported user counts; `RawActorId` sits last in the sort key so cardinality never widens the prefix — ADR-128 §21). Newly named actors flow into person discovery on the existing pull path (`pullerWorker.ts:534-536`, `syncPeopleFactsFromPull`), so OpenAI user ids start minting discovered-person rows once the flag opens.

## Open questions

None blocking. Follow-up (owner: Sergio): whether to surface "named from <date>" on the cost screen so a half-named month reads as designed rather than broken.

## Revisions

- v1 (2026-09-06) — Initial. Framing + four forks locked by Sergio Esteban (captain). Overruled recommendations recorded: provider scope (all, not two), shared helper (yes, not one-off).
- v2 (2026-09-06) — Post-red-team rewrite, direction approved by Sergio. Scope narrowed by Sergio's ruling to **OpenAI + Databricks now, Anthropic + Copilot paused** (supersedes v1's "all pullers"; the v1 fork record stands as history). New Decision 4: actor rides the payload, never the key — restatement keys and buckets are byte-identical before and after. Citations corrected against code (OpenAI `userId` dimension `:802`, actor `:848`; `currencyCode` defaults `"USD"`; compliance actor is an email `:50`). Added: pre-event erasure suppression note (Decision 6), person-discovery consequence.
