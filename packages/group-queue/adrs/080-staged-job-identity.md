# ADR-080: A staged job id is stable identity, never mutable state

**Status:** Accepted

**Behavioural contract:**
[staged-job-id-identity.feature](../specs/staged-job-id-identity.feature)

## Context

A queue job needs an identity that producers, consumers, Redis keys and
operators can use to refer to the same work. Retry attempts and timestamps are
mutable delivery state; encoding them into the id makes the id grow, changes
deduplication semantics and prevents reliable lookup.

## Decision

The staged job id is derived once from stable queue and application identity.
Retry, restage, exhaustion and poison parking reuse it verbatim.

The retry attempt belongs to the canonical envelope header. Queue machinery
can read and advance it without resolving or rewriting the body. The group's
retry chain is an independent monotonic guard used when a body cannot be read
or sibling work leads the next claim.

Recording an attempt and restaging the job is one atomic queue transition. A
job is not restaged when its attempt cannot be recorded. The next attempt uses
the greater trusted value from the message and group chain.

The active heartbeat stops when the job's outcome is decided, before a retry
is restaged under the same id. This prevents the completed claim's heartbeat
from extending the backoff window of the restaged job.

## Consequences

- Job ids are bounded, deterministic and operator-searchable.
- Attempts can advance while payload bytes and content references remain
  unchanged.
- Retry ladders remain bounded when a payload body is unreadable.
- Heartbeat ownership is tied to a claim, not merely to the stable job id.
