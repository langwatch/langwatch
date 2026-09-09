Feature: Langy session-key maintenance

  A Langy session key is minted per turn and revoked when the turn ends, but
  revocation is best-effort by construction: a manager that is SIGKILLed — OOM,
  node eviction, force-delete — fires no callback at all. The keys carry a
  six-hour expiry and verification already refuses an elapsed one, so what the
  hourly sweep closes is the tail of live-looking rows behind a manager that
  died, not an authentication hole.

  The sweep holds no project and no organization. It runs cross-tenant and by
  predicate, which is why the predicate is spelled out here rather than left to
  the query: a widened one revokes customer keys across every organization at
  once.

  @unit
  Scenario: The session-key sweep revokes only elapsed Langy session keys
    Given a Langy session key whose lifetime has passed
    When the sweep runs
    Then the key is revoked as of the moment the sweep read the clock
    And only keys carrying the reserved Langy session name are considered

  @unit
  Scenario: A caller cannot widen which keys the sweep may touch
    Given a process composing the sweep
    When it asks the sweep to run
    Then it has no way to name which keys are in scope

  @unit
  Scenario: The session-key sweep leaves live and already-revoked keys alone
    Given a session key that has not yet elapsed and one already revoked
    When the sweep runs
    Then neither key is written again

  @unit
  Scenario: A session key with no expiry is never swept
    Given a Langy-named key created without an expiry
    When the sweep runs
    Then the key is left untouched

  @unit
  Scenario: The session-key sweep reports how many keys it retired
    Given three elapsed session keys
    When the sweep runs
    Then it answers three
    And the lifecycle counter records three reaped keys

  @unit
  Scenario: A sweep that retired nothing stays quiet
    Given no elapsed session keys
    When the sweep runs
    Then the lifecycle counter is not touched

  # Two graphs register this pipeline: the App's legacy registry and the
  # packaged worker's own composition. They must register the same routing keys
  # or the shared queue carries a key only one consumer stages, and a sweep that
  # never runs looks exactly like a sweep that found nothing.

  @unit
  Scenario: The worker composes the session-key sweep from the feature package
    Given a worker graph composed with the process database
    When the Langy maintenance feature installs
    Then it registers the Langy maintenance pipeline
    And the pipeline's sweep runs the feature's own revoke

  @unit
  Scenario: The session-key sweep keeps one set of routing keys across both graphs
    Given the legacy registry holds a frozen copy of this pipeline
    When either graph registers it
    Then the pipeline and its scheduled process carry the names the twin carries

  @unit
  Scenario: Both graphs count reaped keys into one series
    Given the App counts through its own registry and the worker over OTLP
    When either of them reaps a key
    Then the count lands on the same metric name under the same operation label
