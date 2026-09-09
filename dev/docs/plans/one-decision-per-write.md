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
| Write verbs to convert | **32** across 4 services |
| Call sites of those verbs | ~12 — **10 discard the return value** |
| Call sites that read the returned facts | **2** |

The last row is the whole reason this is tractable. The layer exists to give
callers a synchronous answer, and almost nobody takes it.

## Stages

Each stage is meant to land on its own and leave the tree green. The order is
chosen so the user-visible defect is fixed early and the risky part happens
late, with everything dead by the time it is deleted.

### 0. Decide the unfinished-sign-up behaviour — **Alex, not code**

Blocks stage 5 only. Everything before it can proceed. See "Open decisions".

### 1. Add the seam, change nothing — *small, additive*

Add `dispatch(command): Promise<Applied>` beside the existing ledgers: dispatch
through the pipeline sender that already exists, then wait on the projection
cursor using the comparison `StagedLedgerWriter.awaitConvergence` already
implements. Nothing calls it yet.

*Touches:* one new module. No existing behaviour.

### 2. Fix the two callers that read facts — *small, and it is the bug fix*

- `join-request-adapters.ts` — notify from the recorded state rather than from
  `facts.length`. **This is the live hazard**: an admin approving inside the
  expiry window can currently produce both a membership and a "your request
  lapsed" email.
- `account-identifiers.service.ts` — read `identifierId` from the identifier
  row after the write applies, instead of off a fact that may not have been
  recorded.

*Touches:* 2 files + tests. **If this plan gets compressed hard, keep this
stage.** It is the only part that fixes something a person can currently be
told wrongly, and it does not depend on the rest.

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

### 5. Delete provisional heads, implement the honest wait — *the risky one*

`writeProvisionalHeads` and `hasFolded` go. The born-finalized entrance
(ADR-116 §3) currently sequences row writes between the two legs and must keep
its ordering guarantee without them. Sign-up gains the state decided in stage 0.

*Touches:* `ledger.ts`, `birth.ts`, the born-finalized entrance, the sign-up
screens, and the specs that describe them. **Do not compress this stage into
another.** It is the one that can strand a sign-up.

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

**The unfinished sign-up.** When the fold has not landed inside the window:

1. What does the person see — a blocking "setting up your account" screen, or
   the product with the new address shown as pending?
2. How long is the window before we say so?
3. If the fold never lands, do we offer a retry, or tell them to sign in again?

These are product calls, and stage 5 cannot be written without them.

**How wide is "applied"?** Stage 1 waits on one aggregate's cursor. A write
that fans out across aggregates has no single cursor to wait on. Confirm none
of the 32 verbs does that, or the wait needs a different shape.

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
