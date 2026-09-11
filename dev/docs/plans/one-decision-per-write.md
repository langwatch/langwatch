# One decision per write — implementation plan

The decision is [ADR-135](../adr/135-a-write-states-its-facts-once.md); the
behaviour is
[specs/identity/one-decision-per-write.feature](../../../specs/identity/one-decision-per-write.feature).
This file is only the route from here to there, and the sizes, so it can be cut
down before anyone starts.

Lands in PR #7631, on `feat/identity-auth`.

## What is actually there

| | |
| --- | --- |
| Ledger writers, app layer | **1,278 lines** across 6 files |
| Ledger ports, `@langwatch/identity-server` | **106 lines** across 5 files |
| Write verbs to convert | **34** across 5 services |
| Call sites of those verbs | **40** — 36 discard the return value |
| Call sites that read the returned facts | **4** |
| Call sites that depend on a synchronous throw | **2** (`tolerateRefusal`) |

The last rows are the whole reason this is tractable. The layer exists to give
callers a synchronous answer, and 9 in 10 do not take it.

> Corrected 2026-09-10. The first pass said 32 verbs / ~12 call sites / 2
> readers; it counted `platform/app/src` only and missed 14 sites in
> `packages/identity-server/src`, two of which are readers. `link-proposal`
> adds `confirmLink`/`rejectLink`, making 34 verbs across 5 services. The
> `birth.ts` entrance is a writer path too and is in none of these counts —
> it bypasses `commit` by design — so stage 3 has to convert it explicitly.

## Stages

Each stage is meant to land on its own and leave the tree green. The order is
chosen so the user-visible defect is fixed early and the risky part happens
late, with everything dead by the time it is deleted.

### 0. Decide the unfinished-sign-up behaviour — **DONE 2026-09-10**

**The door does not wait.** Sign-up returns once it has committed its own rows
and handed the command to the queue; the wait moves to the surfaces that read
projections, and they say "still being set up" rather than rendering an empty
state. ADR-135 §Decision 5 carries the wording and the two rejected options.

One correction that came out of deciding it: the session is issued from the
Postgres `User` row the entrance commits directly, **not** "from the event log".
`stage` is an enqueue, so at session time the log has not been written. The door
is honest because it claims only what it wrote itself.

### 1. Design the completion signal — **BLOCKED, and not what this said**

This used to read "add `dispatch(command): Promise<Applied>` beside the existing
ledgers, waiting on the cursor with the comparison `awaitConvergence` already
implements. Nothing calls it yet." That cannot be built as written.

`awaitConvergence` compares the cursor against **the last event it was handed**.
A `dispatch` that no longer decides has no events to hand it, so there is no
comparison target. "The cursor moved past dispatch time" does not substitute: a
command that legitimately states nothing never moves the cursor, and another
command on the same lane can move it first. Without a target, *applied*,
*refused* and *not yet* are one answer.

So stage 1 is a **design** task, not an additive one: a per-command outcome the
handler records (`{commandId, outcome}`) and dispatch reads. Build it as the
replacement rather than as a sibling — a seam that "changes nothing" is a second
copy of a layer being deleted, and it could not be a no-op anyway.

**Stages 3, 4 and 6 depend on this. Stage 2 does not, which is why stage 2 went
first.**

### 2. Fix the callers that read facts — **DONE, commit `49f323f317`**

It was three, not two — the third was found while checking the other two, and it
is the same defect class reaching a person:

- `join-request-adapters.ts` — notifies from the recorded PENDING → EXPIRED
  transition rather than from `facts.length`. **This was the live hazard**: an
  admin approving inside the expiry window could produce both a membership and a
  "your request lapsed" email.
- `account-identifiers.service.ts` — reads `identifierId` off the heads after
  the write, so a confirmation link can never name a row the queue did not
  write.
- `verification-ceremony.service.ts` — answers from the identifier's recorded
  state. Both directions of the old divergence lied: "lost" while the queue
  verified tells somebody their own address belongs to a stranger; "won" while
  the queue dead-ended tells them an address is theirs when it is not.

Reading what landed admits a third answer the old code could not represent —
*not recorded yet* — so there is a new handled code for it,
`identity_verification_not_settled`, with the proof left unconsumed so "open the
same link again" is real remediation. One new bound scenario; 58/58 in
`identity-storage-adapter.feature`.

`sso-connection-grandfather.service.ts` also reads `facts.length`, into a proof
report rather than to a person. Left alone deliberately: it is not a lie told to
anybody, and it disappears in stage 3.

This needed none of the rest of the plan, which is the argument for having done
it first.

### 3. Verbs return receipts — *wide but mechanical*

Change the 32 verbs to validate, dispatch, and return `{ commandId, applied }`.
Ten call sites need no edit at all — they already ignore the value. Guard calls
come off the calling path here.

*Touches:* 4 service files, ~12 call sites, their tests.

### 4. Stop the calling path appending — *narrow, high value*

Three ledgers (mfa, join-request, sso-connection) append on the calling path
*and* stage a command whose handler produces the same events. Identity and
directory-sync already pass `waitedAppend: null`. Make it uniform: the queue is
the only appender. `WaitedAppend` and its plumbing go.

*Touches:* 3 ledger configs + the base class.

One thing to state out loud before doing it: durability moves from "appended
before return" to "enqueued before return". The timeout log line that currently
promises "the append is durable and the fold will converge" stops being true,
and a dropped queue job now loses a fact that used to be on disk —
`consumeBackupCode` and `confirmMfa` included. Decide whether that is accepted,
and fix the log line either way.

### 5. Delete the provisional WRITE — keep the probe — *the risky one*

`writeProvisionalHeads` goes. **`hasFolded` stays**, and an earlier version of
this plan was wrong to bin it with them.

Today `hasFolded` exists only to stop the attach guard deduping against a
provisional row. Under the A1 decision it picks up a bigger job: it is the only
thing that distinguishes *the fold has not run* from *this person genuinely
holds nothing*. Every read surface needs that bit to say "still being set up"
instead of rendering an empty state — so deleting the write is the change, and
deleting the probe would leave every reader guessing.

Order inside the stage matters: remove the provisional **write** before or with
the guard's probe, never the probe first. With provisional rows still being
written, a guard that can no longer tell them apart dedupes against one and the
log never gets the event — the address lock then holds forever.

Two corrections to what this stage claimed:

- **The born-finalized entrance is gone (2026-09-11), which removes this
  question rather than answering it.** It was the one caller that bypassed
  `commit` — calling the guard, staging, committing rows and awaiting the fold
  directly — so it was also the one dispatch shape an outcome channel would
  have had to serve on top of the ordinary one. It never used provisional heads
  (`writeProvisionalHeads` lives only inside `IdentityLedgerWriter.commit`), and
  it never executed at all: it armed only for a route that 404s. Retired in
  ADR-116 §3; `stage`/`awaitFold` are private again and every ceremony goes
  through `commit`. Design the channel against that single path.
- **`/auth/join` is the surface that breaks first.** `verifiedEmailsOf` answers
  `[]` rather than `null` for a finalized user with empty heads, so the legacy
  `User.email` fallback is skipped and the join lookup says `{outcome: "none"}`
  — a new account on a verified company domain is told nothing matches it and
  pushed to create its own organization. That is the orphan-workspace outcome
  join-before-create exists to prevent. Teach this surface the two-meanings
  distinction BEFORE the block comes off the door.

*Touches:* `ledger.ts`, `birth.ts`, `guards.ts` + the heads port and its
in-memory double, `identity-email.service.ts`, the join lookup, the sign-up
screens, and the specs that describe them. **Do not compress this stage into
another.**

### 6. Delete the layer — *pure removal*

Five ports, five writers, five deps interfaces, the `ConvergentLedgerSpec`s,
the sender-name maps, `StagedLedgerWriter`, `ConvergentLedgerWriter`. Nothing
calls them by now.

*Touches:* ~1,384 lines removed; `runtime.ts` composition shrinks.

### 7. Bind the spec, remove the debt — *required to call this done*

Swap each `@unimplemented` for the tag named in the comment above it, add the
`@scenario "<title>"` annotation on each covering test, and **delete the
`LEGACY_INERT` entry** for the feature file. That entry says in writing that it
must go; while it is there, the change is not finished.

## Open decisions

**~~The unfinished sign-up.~~** Answered 2026-09-10 — see stage 0. The door does
not wait; the read surfaces carry the state. Questions 2 and 3 dissolved with it:
there is no window on the door to size, and "the fold never landed" is now a
thing a *screen* reports rather than a thing that strands a sign-up. The one
sub-question that survives is narrower and is in the spec as a scenario: what a
waiting screen offers when the fold never lands — retry, or carry on without it.

**What a guard is for.** ADR-135 §Decision 1 says a verb "does not run a guard".
Too strong, and shipping it literally would be worse than the defect: the guards
throw 37 domain errors synchronously, so a wrong authenticator code would come
back as a receipt. Split them — **preconditions** (refuse; must stay on the
calling path; harmless to run twice since a refusal writes nothing) versus
**decisions** (state facts; run once, on the queue). Only the second is what this
change is about. ADR-135 §"What a guard is for" now records this; the stage-3
work has to honour it verb by verb.

**The completion signal.** See stage 1. Unresolved, and it blocks 3, 4 and 6.

**How wide is "applied"?** Stage 1 waits on one aggregate's cursor. A write that
fans out across aggregates has no single cursor to wait on. Confirm none of the
34 verbs does that, or the wait needs a different shape.

**Opt in to the wait.** `Applied` with a bounded wait on every call spends up to
two seconds on behalf of the 36 callers that read nothing — the backfill and the
sweep most of all. Make the wait something a caller asks for.

## Risks

- **The queue joins sign-up's critical path.** This is the trade ADR-135
  accepts; stage 0 is how it is paid. If the answer to stage 0 is "no visible
  change is acceptable", this plan does not work and provisional heads have to
  be replaced by something else rather than deleted.
- **Stage 3 is wide.** 32 verbs, and their tests assert on returned facts.
  Expect the test churn to exceed the source churn.
- **`packages/authz-server/src/ledger` has the same defect** and is out of
  scope. Identity and authz will disagree in shape until it follows.

## Not in this change

- Renaming ledger → journal. Most of the layer is being deleted; naming what
  survives is a later, smaller question. ADR-135 records why.
- Anything in authz.
