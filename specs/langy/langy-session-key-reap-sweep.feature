# Implementation:
#   platform/app/src/server/event-sourcing/langy-maintenance/index.ts
#   platform/app/src/server/app-layer/langy/langyApiKey.ts (reapExpiredLangySessionApiKeys, unchanged)
#
# Greenfield rewrite of event-sourcing.old/pipelines/langy-maintenance/
# (read-only reference for this rewrite) onto @langwatch/event-sourcing
# (ADR-098, ADR-100, ADR-102). Distinct from specs/langy/langy-session-key.feature
# and specs/langy/langy-session-key-lifecycle.feature, which cover minting and
# scoping a session key — this file covers only the scheduled sweep that
# revokes elapsed ones nothing else caught.

Feature: Langy session-key reap sweep

  A Langy session API key is scoped to one chat session and carries its own
  TTL. Revoking one when its manager sees a worker die is the fast path, but
  a manager that is SIGKILLed (OOM, node eviction, force-delete) sees nothing
  and runs no cleanup — every key its workers held then stays valid for the
  rest of its TTL. No callback can close that hole, because the process that
  would make the call is the one that died. THIS SWEEP IS THE GUARANTEE, not
  a redundant backstop: on a fixed interval, it revokes every session key
  whose lifetime has already elapsed, regardless of whether anything reported
  its worker's death.

  This is queue-infrastructure maintenance, not a conversation concern: it
  carries no aggregate, no events and no commands, and it spans every tenant
  by design.

  Rule: The reap runs on its own clock, independent of any worker's shutdown

    @unit
    Scenario: The scheduled reap revokes every elapsed session key
      Given the reap's fixed interval wakes it
      And elapsed, unrevoked session keys exist
      When the reap runs
      Then it revokes every one of them in a single statement
      And it records that tick once

  Rule: A failed reap is retried, not swallowed

    @unit
    Scenario: A failed reap is counted as one failed candidate
      Given the reap fails
      When the tick finishes
      Then the failure is counted on the same outcome metric a successful
        reap's count is counted on
      # reapExpiredLangySessionApiKeys is one bulk UPDATE, not a per-key
      # loop — Postgres commits every matching row or none, so a thrown
      # reap is exactly one failed candidate, not a count to derive

    @unit
    Scenario: A failed reap is retried
      Given the reap fails
      When the tick finishes
      Then it raises so the whole tick is retried
      # retrying is free: a key already revoked stays revoked, so
      # re-reaping costs one wasted query, never a double effect

  Rule: Tick bookkeeping never costs the reap its own result

    @unit
    Scenario: A bookkeeping failure does not fail a successful reap
      Given the reap succeeds
      And recording the tick fails
      When the tick finishes
      Then the reap is not reported as failed
      # losing today's bookkeeping is recoverable at the next tick; losing
      # today's actual reap result to a bookkeeping error would not be

    @unit
    Scenario: Tick bookkeeping still runs after the reap fails
      Given the reap itself fails
      And recording the tick also fails
      When the tick finishes
      Then the reap's own failure is what gets raised, not the bookkeeping one
      But recording the tick was still attempted

  Rule: The reap is mounted for a future scheduler, not run ad hoc

    @unit
    Scenario: The mount carries the hourly interval and runs the same reap logic
      Given the reap is described as a mount
      Then it names itself and carries an hourly interval
      And running the mount executes the same reap the interval is for

  # ============================================================================
  # Known Limitations
  # ============================================================================

  # - No scheduler runtime exists yet in @langwatch/event-sourcing, the
  #   identical gap specs/event-sourcing/blob-cleanup-sweep.feature
  #   documents. This pipeline exposes a plain { name, intervalMs, run }
  #   descriptor for a future scheduler to mount.
  # - The reap itself (reapExpiredLangySessionApiKeys) already logs and
  #   meters its own outcome under a different logger name
  #   (langwatch:langy:api-key). This pipeline deliberately does not add a
  #   second success line for the same event.
