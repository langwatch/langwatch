# Langy implementation handoff

Updated: 2026-07-16

## Architecture now implemented

- ClickHouse `event_log` remains the canonical event source.
- Langy conversation, turn, and message operational projections are stored in Postgres through `.withProjection()` state folds.
- Operational state uses application-layer dependency injection and service/repository boundaries.
- Projection identity and access are scoped by tenant/project, user, and conversation.
- The Langy process manager has durable Postgres inbox, state, and outbox storage.
- Initial worker dispatch and title generation are owned by the process outbox.
- Liveness and conversation broadcasts are direct event subscribers.
- OpenTelemetry context is propagated through subscribers, process handling, and outbox effects.
- ClickHouse contains the canonical event log plus the Langy analytics event projection; it is not an additional operational fact store.
- Legacy Langy spawn/title reactors and ClickHouse operational projections were removed.
- State projection replay pauses and drains the live state queue, rebuilds from the event log, and resumes without invoking subscribers or process effects.

## Database state

- Consolidated Langy operational projection migration applied manually.
- Process manager store migration applied manually.
- `ProcessManagerOutbox.leaseToken` column and unique index applied manually.
- Prisma migration ledger resolved.
- `pnpm prisma migrate status` reports the schema is up to date.
- Prisma reads against all six new tables succeed.

## Validation already completed

- Production typecheck passed before the latest test cleanup.
- `pnpm typecheck:tests` now passes after the delegated fixture cleanup.
- Langy UI/server cleanup: 122 focused tests passed.
- Event-sourcing state/replay fixture cleanup: 45 focused tests passed.
- Process manager/store validation: 44 unit tests and 10 Postgres integration tests passed.
- Langy composition validation: 85 tests passed, one existing test skipped.
- Analytics/retention validation: 63 focused tests passed; ClickHouse migration was idempotent across two runs.
- Architecture cleanup validation: 60 focused tests passed.

## Exact remaining work

1. Re-run production typecheck, test typecheck, Prisma validation/status, focused Langy suites, and `git diff --check` against the combined shared-worktree changes.
2. Review every delegated/Claude diff before accepting it; preserve unrelated user changes in the dirty worktree.
3. Finish the replay loader correction: `batchLoadAggregateEvents` still pages by `EventId` alone. Change its upper bound, cursor, and ordering to canonical `(EventTimestamp, EventId)` and update fold/map/state replay callers plus tests. A previous multi-file patch failed to apply, so no partial change from that attempt exists.
4. Confirm the live evaluation invariant: random `evaluationId` is identity only; one evaluation is a stateful fold grouped/serialized by evaluation ID; canonical event position is separate. Map means stateless per-event transformation, not one record ever.
5. Collect the live-evaluation FIFO audit result from the delegated agent and accept only evidence-backed fixes/tests.
6. Collect the Claude CLI outbox-hardening result and review it. The launched CLI process has unified exec session `68917`; it was still running but had emitted no output at the time of this handoff.
7. Perform a final stale-reference search for removed Langy reactors, Redis operational cache assumptions, direct initial dispatch, old ClickHouse operational facts, shadow/flag rollout language, and obsolete migrations.
8. Inspect the final migration files and generated Prisma client/schema consistency one last time.
9. Summarize the completed architecture, validation evidence, and any remaining known risk. Do not add a rollout flag: this feature only exists on this branch and should work fully before merge.

## Ordering terminology

- `OccurredAt`: when the business action happened; may arrive late and is not a safe delivery cursor.
- `AcceptedAt` / event `createdAt`: when the canonical log accepted the event.
- `EventId`: unique tie-breaker for equal accepted timestamps; production creation currently generates a KSUID.
- Aggregate IDs, including evaluation IDs, never establish event order.
- `.withProjection()` is semantically a fold with a direct operational Postgres store contract.
- `mapProjection` processes each event independently and may emit zero or one row per event; it can emit many rows over an aggregate lifetime.

## Active ownership boundaries

- Root owns the replay tuple-cursor correction and final integration validation.
- Delegated evaluation audit owns live evaluation grouping/FIFO tests only, not replay.
- Claude CLI was assigned Langy process-outbox crash/retry hardening only, excluding replay, evaluation processing, UI, Prisma migrations/schema, ADRs/specs, and ClickHouse analytics.

