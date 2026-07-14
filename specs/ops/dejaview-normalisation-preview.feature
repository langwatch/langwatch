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
    And the preview reports how many spans each rule matched

  Scenario: An invalid regex in a rule fails the run with a clear error
    Given the operator adds a mapping rule with an invalid regex
    When the operator runs the normalisation preview
    Then the run is rejected naming the offending rule
    And no preview results are produced

  Scenario: Nothing is written
    When the operator runs the normalisation preview
    Then stored spans, projections, and events are unchanged

  Scenario: Aggregates without span events report clearly
    Given the aggregate has no span-received events
    When the operator runs the normalisation preview
    Then the preview reports that there is nothing to replay
