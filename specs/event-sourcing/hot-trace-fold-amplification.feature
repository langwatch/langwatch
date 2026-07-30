Feature: Hot-trace fold amplification is bounded

  Order-insensitive trace folds (traceSummary and its slim mirror
  traceAnalytics) accumulate distributed spans that, by nature, arrive in any
  order. A late-arriving span must simply be applied on top of the fold's
  current state — never trigger a full re-fold of the aggregate's event
  history.

  # Why this file exists — incident 2026-07-09
  #
  # Re-folding on every out-of-order batch is the 2026-07-09 storm: replaying
  # the whole history read every event for the aggregate and raised the
  # checkpoint to the aggregate's maximum event time, so every later batch also
  # looked out of order. A hot trace (a Claude Code session streams 100k+
  # events into one aggregate) then re-folded forever and never caught up. On
  # 2026-07-10 a single trace held 112k staged fold jobs draining at ~0 for
  # this reason. (ADR-098 cites this incident.)
  #
  # This file used to specify the fix as a per-fold opt-out: a fold could
  # declare itself "order-insensitive" and skip a re-fold that every other
  # fold still took by default (`refoldOnOutOfOrder`, `canRefold`, an
  # `eventLoader` wired per fold). ADR-098 decision 4 retired that mechanism
  # platform-wide rather than widening the opt-out: no fold — trace, evaluation
  # or otherwise — may re-fold from the event log on a late-arriving event, and
  # there is no flag left to opt in or out of. `refoldOnOutOfOrder` and
  # `canRefold` exist only in the pre-rewrite implementation
  # (`event-sourcing.old/`); the live pipelines have nothing to opt out of.
  #
  # The guarantee this file protected — a late span never becomes a full
  # history replay — is now universal and checked structurally rather than
  # asserted per fold: order-invariance.feature specifies the property every
  # fold must satisfy, and fold-read-back-store.feature specifies the cold-path
  # recovery (from the fold's own stored row, never from event_log) that
  # replaces the re-fold this file used to test. Neither singles out trace
  # folds, because decision 4 no longer does either — an evaluation fold that
  # once re-folded "because order is significant" is held to the same
  # order-invariance requirement as traceSummary now.
