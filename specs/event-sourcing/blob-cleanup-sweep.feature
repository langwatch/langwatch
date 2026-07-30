# Implementation:
#   platform/app/src/server/event-sourcing/blob-maintenance/index.ts
#
# Greenfield rewrite of event-sourcing.old/pipelines/blob-maintenance/
# (read-only reference for this rewrite) onto @langwatch/event-sourcing
# (ADR-098, ADR-100, ADR-102). See index.ts's module docblock for the
# deliberate gap this rewrite leaves open: no scheduler/process-manager
# runtime exists in @langwatch/event-sourcing yet, so this pipeline exposes a
# plain { name, intervalMs, run } descriptor for a future scheduler to mount.

Feature: Blob-cleanup sweep

  GroupQueue2's job-payload spool holds an oversized job's staged payload as
  a content-addressed blob, reclaimable once every job holding a lease on it
  completes. A worker that dies mid-flight never releases its lease, so a
  scheduled sweep is the only thing that reclaims what it was holding: on a
  fixed interval, it walks every registered queue's blob keyspace and
  reclaims blobs no lease still references, past their grace window.

  This is queue-infrastructure maintenance, not a domain pipeline: it carries
  no aggregate, no events and no commands.

  Rule: The sweep runs on its own clock and reports what it finds honestly

    @unit
    Scenario: The scheduled sweep reclaims unreferenced blobs
      Given the sweep's fixed interval wakes it
      When the sweep runs
      Then it walks the blob keyspace and reclaims what is unreferenced
      And it records that tick once

    @unit
    Scenario: A truncated scan is reported, not folded into a healthy total
      Given a queue's blob keyspace exceeds the sweep's per-queue scan ceiling
      When the sweep runs
      Then the tick still completes
      But the truncation is logged on its own line
      # truncation looks exactly like a healthy sweep in the reclaim/repair
      # totals, so it must never be silently indistinguishable from a
      # complete pass

  Rule: A sweep that fails every candidate must not report success

    @unit
    Scenario: Candidate failures are counted on the same metric as successes
      Given the sweep evaluates a mix of blobs, some of which fail
      When the sweep finishes that tick
      Then the failed blobs are counted on the same outcome metric as the
        succeeded ones
      # the defect this replaces: event-sourcing.old's BlobSweeper caught
      # and logged a per-blob failure with no counter at all, so a sweep
      # that failed every single candidate still reported success

    @unit
    Scenario: A tick with any candidate failures is retried
      Given the sweep evaluates a mix of blobs, some of which fail
      When the sweep finishes that tick
      Then it raises so the whole tick is retried
      # retrying is free: a blob already reclaimed stays reclaimed, so
      # re-sweeping costs one wasted scan, never a double effect

    @unit
    Scenario: A sweep that cannot even walk the keyspace is retried
      Given the sweep's underlying walk fails outright, before any blob is evaluated
      When the sweep runs
      Then it raises so the tick is retried
      And it still records that the tick happened

  Rule: Tick bookkeeping never costs the sweep its own result

    @unit
    Scenario: A bookkeeping failure does not fail a successful sweep
      Given the sweep reclaims blobs successfully
      And recording the tick fails
      When the sweep finishes
      Then the sweep is not reported as failed
      # losing today's bookkeeping is recoverable at the next tick; losing
      # today's actual reclaim result to a bookkeeping error would not be

    @unit
    Scenario: Tick bookkeeping still runs after the sweep fails
      Given the sweep itself fails
      And recording the tick also fails
      When the sweep finishes
      Then the sweep's own failure is what gets raised, not the bookkeeping one
      But recording the tick was still attempted

  Rule: The sweep is mounted for a future scheduler, not run ad hoc

    @unit
    Scenario: The mount carries the five-minute interval and runs the same sweep logic
      Given the sweep is described as a mount
      Then it names itself and carries a five-minute interval
      And running the mount executes the same sweep the interval is for

  # ============================================================================
  # Known Limitations
  # ============================================================================

  # - No scheduler runtime exists yet in @langwatch/event-sourcing (only
  #   definePipeline, the fold/map executors, the store contracts and the
  #   group-key descriptor are exported). This pipeline exposes a plain
  #   { name, intervalMs, run } descriptor for a future scheduler to mount —
  #   see index.ts's module docblock.
  # - Per-blob failure counting depends on the `sweep` port populating
  #   BlobSweepOutcome.failed, which event-sourcing.old's BlobSweeper
  #   (read-only reference for this rewrite, unmodified) does not do today —
  #   its per-key catch has nothing to report into. Until it does, this
  #   pipeline can detect a sweep that fails OUTRIGHT but not one that
  #   silently drops individual blobs.
