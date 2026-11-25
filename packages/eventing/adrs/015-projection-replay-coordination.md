# ADR-015: Projection replay coordinates with live delivery by cutoff

**Status:** Accepted

**Behavioural contract:**
[projection-replay.feature](../specs/projection-replay.feature)

## Context

A projection can be rebuilt from the event log while new events continue to
arrive. Rebuild and live delivery must have an unambiguous ownership boundary:
every event is applied by the replay or by live processing, never by both and
never by neither.

A single global pause would make a large replay an availability event. The
coordination boundary therefore works one bounded batch at a time.

## Decision

The generic replay engine owns a batch protocol built around an event-log
cutoff and per-aggregate markers:

1. select the next bounded aggregate batch;
2. pause the selected projection lanes;
3. drain work already admitted to those lanes;
4. record a cutoff and replay marker for every aggregate in the batch;
5. resume the lanes;
6. load the selected projections' event types through the cutoff and rebuild
   their records in bulk; and
7. complete the markers so live events after the cutoff can proceed.

The lanes resume as soon as their cutoffs are recorded. While the rebuild
continues, live delivery consults the marker:

- an event at or before the cutoff belongs to the replay and is skipped;
- an event after the cutoff is deferred until that aggregate's marker is
  complete; and
- an aggregate outside the batch continues normally.

A failed batch clears its active coordination state and resumes its lanes. An
interrupted replay records completed aggregates so a resume can continue from
the remaining work. A full rebuild deliberately starts with a fresh progress
set.

Fold, map and operational state projections use the same replay run. Event
history is loaded once per batch and fanned out to the selected projection
executors. Rebuilt records are written in bounded bulk operations.

Replay markers and the run's progress/cancellation lease remain renewable for
the entire run, including when one batch lasts longer than the initial lease.

Subscribers and process managers are live-delivery consumers and do not run
during projection replay.

## Consequences

- Projection rebuilds preserve every live event without pausing the whole run.
- The cutoff is the single ownership boundary between replay and live work.
- Replay adapters must support bounded discovery, filtered event loading,
  marker persistence and bulk writes.
- Projection executors must consult replay markers before applying live work.
- Replay-specific product selection and concrete repositories remain in the
  application composition root.
