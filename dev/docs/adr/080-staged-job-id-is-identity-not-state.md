# ADR-080: A staged job id is an identity, not a place to keep state

**Date:** 2026-07-28

**Status:** Accepted

**Relates to:** [ADR-026](./026-groupqueue-payload-envelope.md) (the envelope whose header this promotes to a control-flow input), [ADR-029](./029-groupqueue-content-addressed-payload-store.md) (the content hash the body must not perturb), [ADR-030](./030-groupqueue-blob-handling-hardening.md) §2 (the transient-versus-missing distinction whose fail-safe this relocates).

Behavioural contract: [specs/event-sourcing/staged-job-id-identity.feature](../../../specs/event-sourcing/staged-job-id-identity.feature).

## Context

A GroupQueue staged job id is `<eventId>/<jobType>/<jobName>`. It names one job's occupancy of one group and is used as a Redis ZSET member, a hash field, and the value of the group's active-claim key.

Every retry appended a segment to it — `/r/<attempt>` on the normal ladder, `/r/<Date.now()>` on terminal exhaustion, `/p/<Date.now()>` on a poison park. A job that had been round the ladder therefore wore its whole history:

```text
event_000649zPnIW3V0Ug6yVk9DECNYK3S/subscriber/pm:langyConversation/r/12/r/16/r/24/r/1785261278310
```

Three problems, and they are not equally serious.

The id **grows without bound**, gaining a segment per retry and per operator unblock. It is **not a function of the job**: with a wall-clock segment, re-staging the same job twice yields two different ids, so nothing can tell a repeat from a new arrival. And underneath both, it **encodes state in a name** — the retry count was read back out by counting `/r/` occurrences, which is precisely why the id had to keep growing.

That last one is the actual defect; the other two are its symptoms. The count lived in the id to serve exactly one reader. When a job's body is held in a blob store that is temporarily unreachable, the ladder that decides whether to retry or give up (ADR-030 §2) cannot decode the payload — the payload is what it cannot read — so it could not consult the attempt stamped inside. Counting segments was the available answer.

It was never the only one. A staged value is `<prefix><headerByteLength>|<header><body>`, where the header is plain inline JSON sitting in front of the body. It is what the Lua dispatcher slices to route a job without touching a blob. And queue machinery — including `__attempt` — has travelled in that header since ADR-029, lifted out of the body by `splitMachineryFromBody` specifically so it would not perturb the content hash that collapses a fan-out. The wire FORMAT does not have to change — `__attempt` has ridden in the header since ADR-029. What is new is that the transient ladder now writes one: it used to re-stage its value untouched, which is exactly why it had nothing to read.

Two constraints shaped the decision, both found by reviewing the design rather than by building it.

**Rotating the id was load-bearing.** While a job runs, its worker beats a heartbeat that keeps the group's hold alive for the full active window (300s). `RETRY_RESTAGE_LUA` sets the active key to the *new* id, and its comment says why: a late beat naming the retired id must not be believed. Reuse the id and it matches again — one late beat extends the hold to the full active window and pushes the group's next-eligible score out with it, turning a sub-second backoff into a multi-minute stall. The heartbeat and the re-stage share one Redis connection and are served in send order, so it is not enough to stop the beat when the re-stage *returns*; a beat that fired while the re-stage was in flight has already been sent behind it.

**Removing a carrier can remove a fail-safe.** The transient ladder re-staged the job's value unmodified and never wrote the group's retry chain. With the count in the id, that was survivable — the id carried it. Take the id away without adding a write and nothing advances, and a bounded ladder becomes an unbounded loop. This is a worse failure than the one being fixed.

## Decision

**The staged job id is computed once, when the job is sent, and every later write reuses it verbatim** — retry, exhaustion, and poison park alike. No retry marker, no park marker, no timestamp.

This is safe because a job's id is removed from staging the moment it is claimed (`DISPATCH_BATCH_LUA` ZREMs the member and HDELs its data), so a re-stage always inserts a member that is genuinely absent. The queue-depth increment is already guarded on the insert reporting a new member, so the arithmetic is the one a distinct id produced.

**The retry attempt travels on the message**, in the envelope header, read by a never-throwing header-only reader and advanced by a header-only rewriter that reuses the body string byte for byte. Because the body is unchanged, the content hash is unchanged, the shared blob is not split, and the lease identity survives — advancing an attempt costs no blob I/O.

**The unreadable-body ladder takes the higher of the message and the group's retry chain, and writes the chain on every rung.** Both halves matter. The write is what guarantees termination when the message cannot carry a count. The `max` is what survives a redelivery: with a stable id, an at-least-once redelivery lands on the same staging member and overwrites the waiting job's message with a fresh attempt-1 envelope, so the message alone is not trustworthy. This mirrors the rule the main ladder already uses.

**A legacy `/r/<n>` is read as a last resort, and never written.** The reader takes the highest such segment that is within the retry budget, so the wall-clock stamp the terminal re-stage used to append is not mistaken for a count. A job part-way up the transient ladder at deploy time recorded its count only in the id; without this it would be handed a fresh budget, resetting a fail-safe mid-flight. The segment is a value to interpret on the way out, not a format to keep alive.

**The heartbeat stops before the retry re-stage is issued**, rather than in the worker's outer cleanup. That is the one path that leaves the active key alive for a late beat to match; exhaustion and poison-park re-stage through a script that DELetes the active key in the same atomic step, so a late beat there finds nothing to match and no-ops. The transient ladder needs no guard either — both of its entry points run before the heartbeat is ever started.

Ordering alone is not quite enough, and the gap is worth naming because it is invisible: the cached-script wrapper retries a cache miss AFTER an await, so on a cold script cache that one hop can be issued behind the re-stage. The refresh is therefore also **cancellable**, and the heartbeat withdraws it once stopped.

**Unblocking a group clears every counter that outlived the block** — the retry chain and the consecutive-failure streak, alongside the claim strikes and stored error it already cleared. Both omissions are pre-existing: a group blocked by exhaustion came back with no attempts left *and* a streak already at the quarantine threshold, so its first failure re-blocked it, and whether it did depended on how long the operator took to press the button (the chain expires on its own after 30 minutes). An unblock is an operator saying "try this again"; every counter that decides whether trying is allowed belongs in that reset.

## Rationale / Trade-offs

The alternative considered was to keep a marker in the id but make it a single *replaced* segment rather than an accumulating chain. That is a much smaller change: it bounds the length, removes the wall clock, and — because the id still rotates per attempt — needs no heartbeat surgery and carries none of the termination risk.

It was rejected because it treats the symptoms and keeps the cause. The count would still be read out of a name, the id would still not be a stable identity, and the next reader that wants a job's retry state would still have a string to parse. The heartbeat coupling it preserves is not a feature — it is an undocumented dependency of a lock token on a display name, and leaving it in place means the next person to touch either one rediscovers it the hard way.

What is accepted in exchange: this change alters a queue-wide identity invariant and relocates a termination fail-safe, in the hottest path the queue has. The correctness of the transient ladder now depends on a Redis write (the chain) that previously was not needed, and the backoff's integrity now depends on heartbeat *ordering* rather than on id inequality. Both are pinned by scenarios, and both are more explicit than what they replace — but they are dependencies a reader has to know about, which is why they are written down here rather than left in a Lua comment.

One consequence is deliberately not mitigated. A redelivery arriving while a job waits out its backoff now overwrites that job's message instead of creating a second member. That is the at-least-once path the queue already blesses; the `max` rule makes it harmless to the ladder, and collapsing the duplicate is better than keeping two.

## Consequences

The id becomes a name an operator can look up: the id a job is dispatched under is the id it is blocked, parked, and inspected under. A producer can predict it whenever its payload carries an `id`; reactor jobs still stage without one and get a minted id, which #5538 tracks separately.

`header.m` is promoted from opaque machinery to a field the queue's control flow depends on. Anything that rewrites an envelope must now preserve it, and the header's byte-length prefix must be recomputed on any header change — which the existing `finalize` already does, and which a scenario now pins.

The `/r/`-*writing* paths are deleted, and so is the module that implemented the rejected keep-a-marker design. What survives is a single read-only reader, `legacyStagedJobAttempt`, and it is a migration artifact rather than a second id scheme: it is deleted once no job staged before this deploy can still be in backoff (an hour is comfortably past `GROUP_ATTEMPT_TTL_SECONDS`). Do not remove it before then — it is the only thing standing between an in-flight transient ladder and a fresh budget.

Jobs already staged under grown ids keep working: a worker uses whatever id it was handed, so those ids stop growing and are read for a count only when nothing else can answer.

## References

- Related ADRs: [ADR-026](./026-groupqueue-payload-envelope.md), [ADR-029](./029-groupqueue-content-addressed-payload-store.md), [ADR-030](./030-groupqueue-blob-handling-hardening.md)
- Specs: [staged-job-id-identity](../../../specs/event-sourcing/staged-job-id-identity.feature), [groupqueue-decode-drop-durability](../../../specs/event-sourcing/groupqueue-decode-drop-durability.feature), [pending-counter-conservation](../../../specs/event-sourcing/pending-counter-conservation.feature), [poison-group-park-guard](../../../specs/event-sourcing/poison-group-park-guard.feature)
