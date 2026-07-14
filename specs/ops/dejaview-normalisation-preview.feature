Feature: Deja View normalisation preview
  As a platform operator debugging span enrichment
  I want to replay a trace's stored raw events through the current canonicalisation code
  So that I can see what the running build would produce — and try extra mapping rules — without writing anything

  # =========================================================================
  # What this covers
  # =========================================================================
  #
  # Span canonicalisation runs inside a map projection at ingest time, so
  # its output is frozen into storage with whatever code was deployed then.
  # Deja View can replay fold projections live, but not the span mapping.
  # The normalisation preview closes that gap: it re-runs the span
  # normalisation pipeline in-process over the stored raw span events of an
  # aggregate and reports what today's code produces, side by side with
  # what is stored. Operators can additionally supply experimental mapping
  # rules (match an attribute key, optionally extract via regex, write to a
  # target key) to prototype new vendor mappings before writing an
  # extractor. Everything is read-only.

  Background:
    Given an operator with ops access viewing an aggregate in Deja View

  Scenario: Replaying a trace shows what the current build produces
    Given the aggregate has stored span-received events
    When the operator runs the normalisation preview
    Then each span shows the attributes the current code produces
    And each span shows which canonicalisation rules fired

  Scenario: Preview shows drift against what is stored
    Given a span was ingested by an older build
    And the current build canonicalises it differently
    When the operator runs the normalisation preview
    Then the span shows the attributes that changed between stored and replayed

  Scenario: Experimental mapping rules are applied on top
    Given the operator adds a mapping rule from a vendor attribute to a canonical key
    When the operator runs the normalisation preview
    Then the preview shows the additional attributes the rule produced
    And each produced attribute names the source key it came from
    And the preview reports how many spans each rule matched

  Scenario: A single event can be previewed
    Given the aggregate has several span-received events
    When the operator selects one event and runs the preview
    Then only that event's span is shown in the results
    And the operator can step to the next event and preview it individually

  Scenario: Rule building suggests known keys
    Given the operator is adding a mapping rule
    Then the source key suggests attribute keys present on the selected event
    And the target key suggests known canonical attribute keys

  Scenario: Rules show their impact on every projection
    Given the operator adds a mapping rule
    When the operator runs the normalisation preview
    Then every projection that folds this aggregate's events is shown
    And each projection shows how its state changes with the rules applied
    # Rules apply across all span events when folding — projections
    # accumulate state over the whole event stream, so a per-event
    # projection fold is not meaningful.
    And projections whose state is unaffected report no change

  Scenario: Expression rules compute values over the span's attributes
    Given the operator adds an expression rule reading an attribute and transforming it
    When the operator runs the normalisation preview
    Then the expression's result is written to the target key
    And an expression can consume its source attribute like an extractor would

  Scenario: An expression that fails on one span does not fail the run
    Given an expression rule that only fits some spans' data
    When the operator runs the normalisation preview
    Then spans the expression fails on report the failure
    And the remaining spans still show their results

  Scenario: An invalid regex or unparseable expression fails the run with a clear error
    Given the operator adds a mapping rule with an invalid regex or expression
    When the operator runs the normalisation preview
    Then the run is rejected naming the offending rule
    And no preview results are produced

  Scenario: Expressions are edited with live assistance
    Given the operator is writing an expression rule
    Then unparseable expressions are flagged as they are typed
    And completions suggest the selected event's attribute keys and available transforms
    And example expressions can be inserted as starting points

  Scenario: Nothing is written
    When the operator runs the normalisation preview
    Then stored spans, projections, and events are unchanged

  Scenario: Aggregates without span events report clearly
    Given the aggregate has no span-received events
    When the operator runs the normalisation preview
    Then the preview reports that there is nothing to replay
