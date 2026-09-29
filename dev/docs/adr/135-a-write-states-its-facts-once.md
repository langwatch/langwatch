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

Of **40** call sites of the identity write verbs, **36 discard the return value
entirely** — a bare `await this.identity.attachIdentifier({...})`. Four read it:

- `account-identifiers.service.ts` takes `identifierId` off the attached fact
  to build the address-confirmation link;
- the join-request expiry above;
- `verification-ceremony.service.ts` reads the facts for a dead-end event to
  decide whether to tell somebody the address belongs to a stranger — the same
  defect class as the expiry, and the second of the three that reaches a person;
- `sso-connection-grandfather.service.ts` counts them into a proof report.

Two more depend on the guard throwing **synchronously** rather than on its
return value: `identity-backfill.service.ts` wraps two dispatches in
`tolerateRefusal`. They are not readers, but they are not indifferent either,
and §"What a guard is for" records what that costs.

> An earlier revision of this section said "roughly twelve call sites, ten
> discard". That count was taken over `platform/app/src` alone and missed all
> fourteen sites in `packages/identity-server/src` — including two of the four
> readers. The argument is unchanged and slightly stronger: the ratio of
> callers-who-read to callers-who-ignore is 1 in 10, not 1 in 6.

So the whole layer — five ports, five writers, five deps interfaces, their
specs and sender-name maps, `StagedLedgerWriter` and `ConvergentLedgerWriter` —
exists to serve four callers, and it served three of them wrongly.

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

   **Open: that wait needs a target it does not yet have.** `awaitConvergence`
   compares the projection cursor against the last event it was handed, and a
   `dispatch(command)` that no longer decides has no events to hand it. "The
   cursor moved past dispatch time" is not a substitute: a command that
   legitimately states nothing never moves the cursor, and an unrelated command
   on the same lane can move it first. So "applied", "refused" and "not yet"
   collapse into one answer, and §Decision 1's receipt cannot distinguish them —
   which also makes the spec's *"A write refused by the rule records nothing and
   says so"* unimplementable as written. A per-command outcome channel (the
   handler records `{commandId, outcome}`; dispatch reads it) is the obvious
   shape and is not yet designed. **This blocks the collapse in §Decision 4, and
   nothing else in this ADR.**

4. **The ledger layer collapses** to one function against the pipeline that
   already registers every command by name:

   ```ts
   dispatch(command): Promise<Applied>
   ```

   `IdentityLedger`, `MfaLedger`, `JoinRequestLedger`, `SsoConnectionLedger`,
   `ScimSyncLedger`, each `*LedgerWriter`, each deps interface, each
   `ConvergentLedgerSpec`, each sender-name map, `StagedLedgerWriter` and
   `ConvergentLedgerWriter` go with it.

5. **The sign-up door does not wait at all.** This is the one genuinely new
   behaviour, decided 2026-09-10, and §"The cost" below is why it is shaped this
   way.

   Sign-up returns as soon as the rows it writes **itself** are committed and
   the command is handed to the queue. It never blocks on the fold. The wait
   moves off the door and onto the surfaces that actually read projections, and
   those say so: *this is still being set up*, with a poll, never a row the log
   has not caused.

   Note what the session is issued from, because it is easy to state this wrongly
   and an earlier draft of this decision did: it is issued from the **Postgres
   `User` row the entrance commits directly** (`birth.ts` → `commitNewborn`),
   which is durable before anything returns. It is *not* issued "from the event
   log" — `stage` is an enqueue (`processor.send(): Promise<void>`), so at the
   moment a session is minted the log has not been written and the fold has not
   run. The door is honest because it only claims what it wrote with its own
   hands.

   Rejected: blocking for a short window and then showing a "setting up your
   account" screen (it puts the queue on the door to buy a state we need
   anyway), and keeping the block with a wider window (it strands the tail and
   the window was never derived from data — see
   `_shared/read-your-writes-window.ts`).

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

Provisional heads buy one thing, and it is real: between a sign-up returning and
its fold landing, the address just registered is an address nobody holds. The
front door reads the `Identifier` projection, so for that window the projection
says this person has no address and no sign-in method.

Deleting the rows does not delete the window. It makes the window **visible**,
which is the point — and it means every reader in that window has to distinguish
two things it currently cannot:

| What the read sees | What it means | What it must say |
| --- | --- | --- |
| no identifier rows, cursor absent | the fold has not run yet | still being set up |
| no identifier rows, cursor present | this person genuinely holds none | the real empty state |

**`hasFolded` is the probe that separates them, so it survives.** An earlier
draft had it deleted along with provisional heads, because it exists today only
to stop the attach guard deduping against a provisional row. Under this decision
it acquires a second, larger job: it is the only signal that tells a read surface
"not yet" rather than "nothing". Deleting the provisional **write** is the
decision; deleting the **probe** would leave every read surface guessing.

The concrete casualty found while checking this is `/auth/join`, and it is worth
naming because it is the opposite of a latency problem. `verifiedEmailsOf`
returns `[]` — an empty list, not `null` — for a finalized user whose heads are
empty. The legacy `User.email` fallback is keyed on `null`, so it is skipped, and
the join lookup answers `{ outcome: "none" }`. A brand-new account on a verified
company domain is therefore told there is nothing to join and pushed to create
its own organization, which is precisely the orphan-workspace outcome
join-before-create exists to prevent. Not blocking the door widens that window
from "however long the fold took" to "until the fold lands", so the surface has
to learn the difference above before the block comes off. This is sequencing,
not a reason to keep the rows.

That is the whole of "accept that this is an eventually consistent system and
handle it": the honesty is in the UI, not in the database — and the UI needs one
bit of information to be honest with.

## What a guard is for

Checking the call sites turned up a distinction this ADR originally flattened,
and getting it wrong would be worse than the defect being fixed.

"Services validate and dispatch; the guard runs once, on the queue" is right
about **decisions** — what facts a command states — and wrong about
**preconditions**. The guards throw 37 domain errors synchronously: a wrong
authenticator code is `IdentityMfaCodeInvalidError`, an address already held is
`IdentityEmailInUseError`, a request already answered is
`JoinRequestNotPendingError`. Move all of that to the queue and the caller gets
a receipt for a write that was refused, and learns nothing.

So a guard does two jobs and they separate cleanly:

- **Preconditions** — "may this happen at all?" They refuse, they are what the
  caller is owed an answer to, and they **must** run on the calling path. Running
  them twice is harmless: a refusal is not a fact, and nothing is written.
- **Decisions** — "what facts does this state?" They produce events, they run
  **once**, on the queue, and their answer reaches the caller only by being read
  back out of the projection.

The defect this ADR removes is entirely in the second category. The first was
never the problem, and §Decision 1's "does not run a guard" is too strong: it
should read *does not decide*.

> Stage 2 of the plan is done (commit `49f323f317`): all three
> readers that reach a person — the join-request expiry, the confirmation link's
> `identifierId`, and the verification ceremony's uniqueness-race report — now
> answer from the projection. That fix needed none of the collapse below, which
> is the evidence for doing it first.

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
