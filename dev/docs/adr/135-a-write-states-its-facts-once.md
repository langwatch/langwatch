# ADR-135: A write states its facts once

**Date:** 2026-09-09

**Status:** Proposed

**Amends:** [ADR-101](101-identity-pipeline-and-identifiers.md) — §2's
read-your-writes wait stays, but it stops being a wait for a decision the
calling path already made and becomes a wait for the queue's.
[ADR-116](116-account-linkage-is-event-truth.md) §3 — the born-finalized
entrance's provisional identifier heads are withdrawn; the entrance keeps its
ordering guarantee by other means.

**Builds on:** [ADR-110](110-grant-aggregates-are-grants.md) — the staged
command is the sole appender. This ADR finishes the sentence: if the staged
command is the sole appender, the calling path is not an appender, not a
decider, and not a source of facts.

**Related:** [ADR-092](092-unified-authorization-engine.md) §13 (the grants
ledger has the same shape and the same defect),
[ADR-129](129-better-auth-is-a-boundary-over-identity-services.md) (the staged
ledger writer machinery this removes),
[ADR-127](127-an-identifier-is-an-aggregate.md).

**Behavioural contract:**
[specs/identity/one-decision-per-write.feature](../../../specs/identity/one-decision-per-write.feature).

## Context

The identity pipeline is already the three things an event-sourced write needs.
A command handler decides and returns events; the framework stores them; a fold
projection reads them:

```ts
// ProposeLinkCommand
async handle(command) {
  const facts = await this.guards.proposeLink(command.data);   // decide
  return identityEventsFor({ command, facts });                // → events
}
```

Nothing more is required for a write to happen. And yet every identity write
runs that decision a second time, first, on the caller's thread:

```ts
// IdentityService
async proposeLink(input) {
  const data = proposeLinkCommandDataSchema.parse(input);
  return this.commit({ type, data }, await this.guards.proposeLink(data));
}
```

Those facts go to a ledger writer, which builds the events again, may append
them, stages the command — and the queued handler decides *again*.

### Three truths, and only one of them is true

`IdentityLedgerWriter.commit` is the clearest specimen. It is constructed with
`waitedAppend: null`, so this path never appends anything:

```ts
const events = identityEventsFor({ command, facts });   // the calling path's decision
await this.writeProvisionalHeads({ command, events });  // projection rows from it
await this.stageAndAwait({ command, events });          // the queue decides again, writes its own
return events;                                          // the caller gets the discarded decision
```

```
                        ┌──────────────────────────────┐
  caller ──▶ guard #1 ──┤ returns facts to the caller  │  ← never written
                        │ writes provisional heads     │  ← overwritten later
                        └──────────────┬───────────────┘
                                       │ stages the command
                                       ▼
                            guard #2 ──▶ event_log ──▶ fold
                                          ▲
                                     the only truth
```

1. the **event log** holds what the queue decided;
2. the **projection** briefly holds rows derived from a decision that was never
   written, until the fold overwrites them;
3. the **return value** hands the caller the decision that was thrown away.

Guards read mutable state. Two runs separated by a queue hop can therefore
decide differently, and `identityEventsFor` stamps
`idempotencyKey: eventIdempotencyKey({ commandId, index })` — which collapses
the two writes into one only when the two decisions are *identical*. That is
precisely the case the architecture cannot guarantee.

### It already reaches a person

`join-request-adapters.ts` decides whether to tell somebody their request
lapsed:

```ts
const facts = await joinRequests().expireJoin({ ... });
// "telling somebody their request lapsed when it did not would be worse
//  than telling them nothing."
if (facts.length === 0 || !request) return;
await this.notifier.requestExpired({ ... });
```

The `facts` are guard run #1. The authoritative run is #2. An admin who
approves inside that window can produce both a membership and an email saying
the request expired. The comment shows the author reasoning about exactly this
failure; the write path quietly denies them the check.

### The synchronous answer is barely used

Of roughly twelve call sites of the identity write verbs, **ten discard the
return value entirely** — a bare `await this.identity.attachIdentifier({...})`.
Two read it:

- `account-identifiers.service.ts` takes `identifierId` off the attached fact
  to build the address-confirmation link;
- the join-request expiry above.

So the whole layer — five ports, five writers, five deps interfaces, their
specs and sender-name maps, `StagedLedgerWriter` and `ConvergentLedgerWriter` —
exists to serve two callers, and it serves one of them wrongly.

## Decision

**A write states its facts once, on the queue.**

1. **Services validate and dispatch.** A write verb parses its input, dispatches
   the command, and returns a receipt — the `commandId` and whether the fold
   applied within the window. It does not run a guard and does not return facts.

2. **The log is the only cause of a projection row.** `writeProvisionalHeads`
   and the provisional-head concept are deleted. No row may assert something the
   event log does not say.

3. **A caller that needs an outcome awaits application, then reads.** The
   projection-cursor wait `StagedLedgerWriter.awaitConvergence` already
   implements becomes the completion signal; after it, the caller reads the
   projection. `identifierId` comes from the row that exists. "Did it expire"
   comes from the state that is. Both are true by construction rather than by
   coincidence.

4. **The ledger layer collapses** to one function against the pipeline that
   already registers every command by name:

   ```ts
   dispatch(command): Promise<Applied>
   ```

   `IdentityLedger`, `MfaLedger`, `JoinRequestLedger`, `SsoConnectionLedger`,
   `ScimSyncLedger`, each `*LedgerWriter`, each deps interface, each
   `ConvergentLedgerSpec`, each sender-name map, `StagedLedgerWriter` and
   `ConvergentLedgerWriter` go with it.

5. **Sign-up says so when it is not finished.** This is the one genuinely new
   behaviour, and §"The cost" below is why it is needed. Where a person is
   waiting on a fold that has not landed inside the bounded window, the screen
   says the account is still being set up and polls. It never renders a row that
   the log has not caused.

## Rationale / Trade-offs

**Why not make the two decisions deterministic instead?** Because a guard's
answer is a function of state, and the two runs observe state at different
times. Determinism here would mean freezing the state the guard reads into the
command — which is a snapshot, which is a third copy of the truth, which is the
problem restated.

**Why not have the queue return its events to the caller?** A command sender is
`processor.send(data, options): Promise<void>` (`mapCommands`) — an enqueue.
Making it resolve with the handler's events is a change to the queue framework
shared by every pipeline, and the projection-cursor wait already gives us an
"applied" signal for free. Take the cheap one.

**Why read the projection rather than the event store?** Because the projection
is what every other reader reads. A caller that read the log directly would be
the only component in the system whose answer could differ from the screen's.

**Why delete provisional heads rather than keep them as a cache?** They are not
a cache — a cache is allowed to be stale, not allowed to be *wrong*. These rows
carry a decision the log may never make, and they are indistinguishable from
folded rows to every reader except the guard that wrote them.

## The cost

This puts the queue on sign-up's critical path. Provisional heads exist
precisely to buy out of that: the front door reads the `Identifier` projection,
the fold runs on the queue, and between a sign-up returning and its fold landing
the address just registered is an address nobody holds.

We accept the latency and answer it honestly. The bounded wait stays. When it
expires, sign-up does not invent a row — it tells the person their account is
still being set up and polls until the fold lands. If the fold never lands, they
see a state that is true (nothing was recorded) rather than one that is
convenient (a row saying it was).

That is the whole of "accept that this is an eventually consistent system and
handle it": the honesty is in the UI, not in the database.

## Consequences

**What goes.** Five ports, five writers, five deps interfaces, five specs, five
sender-name maps, two base classes, the provisional-heads path and its
`hasFolded` probe. Guards stop running twice; envelopes stop being built twice;
three of the five ledgers stop appending events the queue also appends.

**What arrives.** One `dispatch`, one bounded wait, and one new user-visible
state on sign-up. Two call sites change from reading facts to reading rows.

**What this does not do.** `packages/authz-server/src/ledger` and
`platform/app/src/server/app-layer/authz/ledger.ts` have the same shape and the
same defect (ADR-092 §13). They are not touched here. This ADR states the rule
for identity and names authz as the next application of it, so the two do not
drift further apart than they already are.

**Vocabulary, deliberately deferred.** "Ledger" is a poor name twice over. It
already denotes a real money ledger in this codebase —
`gateway_budget_ledger_events`, whose own schema comment labels its columns
`-- Debit payload` — and in bookkeeping the chronological append-only record is
a *journal* while the *ledger* is the posted, aggregated view, so the names here
are inverted with respect to the metaphor they borrow. Renaming is not part of
this change: most of the layer is being deleted, and renaming code on its way
out is waste. Whatever survives should be named for what it does.

## References

- Related ADRs: [ADR-101](101-identity-pipeline-and-identifiers.md),
  [ADR-110](110-grant-aggregates-are-grants.md),
  [ADR-116](116-account-linkage-is-event-truth.md) §3,
  [ADR-092](092-unified-authorization-engine.md) §13,
  [ADR-127](127-an-identifier-is-an-aggregate.md),
  [ADR-129](129-better-auth-is-a-boundary-over-identity-services.md)
- Behavioural contract:
  [specs/identity/one-decision-per-write.feature](../../../specs/identity/one-decision-per-write.feature)
- Lands in PR #7631.
