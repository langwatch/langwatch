Feature: An idempotency key makes a suite run safe to retry
  As a developer starting agent tests from a script, a pipeline or the platform
  I want a retry carrying the key I already sent to join the run it already started
  So that a timeout, a dropped connection or a re-run of my job does not run everything twice

  Background: what a run is identified by, and what the caller can hold.
    A suite run is identified by its BATCH RUN ID. Everything downstream is keyed
    by it: the started event's aggregate, the progress fold, the run history, and
    the platform URL the caller is handed back.

    The caller cannot mint that id. What a caller CAN hold across attempts is the
    idempotency key it chose, and the published description of that field says so
    in as many words: repeat the same key and the retry joins the batch the first
    call started instead of running everything again.

    So the run's identity is DERIVED from the request rather than minted per call:
    the batch run id from the project, the run plan, the key and the configuration
    the run resolved to, and every scenario run id in the batch from that batch run
    id and the item's own coordinates — its scenario, its target slot and its repeat.
    A caller that pins the batch run id itself, which the platform's own run dialog
    does, keeps the id it pinned and the items still derive from it.

    Deriving both halves is the whole property. Deriving the batch id alone would
    be worse than minting it: a retry would land new scenario run ids inside a
    batch whose recorded total was fixed by the first call, so the batch would
    count more items started than it holds.

    There is no stored receipt of a key, so a key repeated over a DIFFERENT
    configuration cannot be refused as a mismatch — it simply identifies a
    different run, and the caller gets two runs the way they do today. That is
    the safe degradation, not a failure path, and it is why the configuration is
    part of what the identity is derived from.

  # --- The same request, sent twice ---

  @unit
  Scenario: A retry carrying the same key is the same run
    Given a run plan over two scenarios and one target
    When the same run is requested twice with one idempotency key
    Then both requests answer the same batch run id

  @unit
  Scenario: A retry carrying the same key starts the runs already started
    Given a run plan over two scenarios and one target
    When the same run is requested twice with one idempotency key
    Then both requests answer the same scenario run ids
    And the queue that collapses a repeated command holds one run per scenario

  @unit
  Scenario: A retry carrying the same key records the run once
    Given a run plan over two scenarios and one target
    When the same run is requested twice with one idempotency key
    Then the queue that collapses a repeated command holds one started suite run

  # --- Two requests that are not the same request ---

  @unit
  Scenario: Two requests with different keys are different runs
    Given a run plan over two scenarios and one target
    When the same configuration is requested twice under two idempotency keys
    Then the two requests answer different batch run ids
    And no scenario run id is shared between them

  @unit
  Scenario: One key over a different configuration is a different run
    Given a run plan over two scenarios and one target
    When one run is requested, and then a run over a different target under the same key
    Then the two requests answer different batch run ids

  @unit
  Scenario: One key over a different set of scenarios is a different run
    Given a run plan over two scenarios and one target
    When one run is requested, and then a run over one of those scenarios under the same key
    Then the two requests answer different batch run ids

  @unit
  Scenario: One key over different run parameters is a different run
    Given a run plan over two scenarios and one target
    When one run is requested, and then a run with a different parameter value under the same key
    Then the two requests answer different batch run ids

  # --- A caller that pins the run's identity ---

  @unit
  Scenario: A caller that sends a batch run id keeps it
    Given a run plan over two scenarios and one target
    When a run is requested with a batch run id the caller chose
    Then the response answers that batch run id

  @unit
  Scenario: A retry that pins the same batch run id starts the runs already started
    Given a run plan over two scenarios and one target
    When the same run is requested twice with one batch run id the caller chose
    Then both requests answer the same scenario run ids

  # --- The ids themselves ---

  @unit
  Scenario: A derived batch run id is still a batch run id
    Given a run plan over two scenarios and one target
    When a run is requested
    Then the batch run id carries the scenariobatch prefix
    And every scenario run id carries the scenariorun prefix

  @unit
  Scenario: Every item of one batch has its own scenario run id
    Given a run plan over two scenarios, two targets and a repeat count of two
    When a run is requested
    Then the eight runs queued carry eight distinct scenario run ids
