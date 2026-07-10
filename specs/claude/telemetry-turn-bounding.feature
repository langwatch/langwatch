Feature: Claude Code telemetry turn bounding
  As LangWatch ingesting Claude Code session telemetry
  I want a single turn's log stream to fan out across ingest lanes and its
  span conversion to stay bounded
  So that one pathological agentic turn cannot serialize all of its work
  behind one queue group or seize the workers converting it.

  # Incident 2026-07-10: Claude Code logs arrive with no trace context; the
  # receiver already synthesizes one trace per TURN (session.id:prompt.id) and
  # groups turns into a session via the conversation id. But one agentic turn
  # can drive thousands of tool/model calls: every log record becomes a
  # recordLog command FIFO'd into the single per-trace command group, and the
  # span-sync reactor re-reads the whole turn's logs on every debounce. The
  # converter's "a turn's log set is small and bounded" assumption was the
  # latent flaw. Trace ids must NOT be split further — tool outputs are
  # recovered from the next model call's request body within the same trace's
  # record set — so the bounding happens in the ingest lane and the reactor,
  # never in the trace identity. Mirrors the existing span-command sharding
  # (specs/event-sourcing/span-command-sharding.feature).

  Background:
    Given a project receiving Claude Code telemetry

  Scenario: one turn's logs fan out across ingest lanes
    Given log-command sharding is enabled with more than one shard
    And a Claude Code turn streaming thousands of log records
    When the records are staged for processing
    Then the records distribute across the turn's shard groups
    And no single queue group serializes the whole turn
    And the emitted events still aggregate under the turn's single trace

  Scenario: the converted turn is identical regardless of sharding
    Given the same Claude Code turn ingested with sharding disabled and enabled
    When the turn's spans are converted
    Then both ingestions produce the same root agent span and children
    And tool outputs recovered from later model calls are present in both

  Scenario: a pathological turn's span conversion is bounded
    Given a Claude Code turn whose log count exceeds the per-turn conversion bound
    When the span-sync conversion runs
    Then the conversion processes at most the bounded number of log records
    And the produced trace is marked as truncated in an observable way
    And the workers remain responsive while the turn is live

  Scenario: session grouping is unchanged by sharding
    Given a session whose turns were ingested through sharded lanes
    When the session is viewed in the product
    Then every turn appears as one trace under the session's conversation
    And turn traces carry the session id as their thread linkage
