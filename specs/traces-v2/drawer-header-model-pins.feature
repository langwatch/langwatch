Feature: The trace drawer header names the model once
  As an operator reading a trace drawer
  I want the models a trace used stated in a single place
  So that the pinned-context strip tells me something the metrics row does not

  # The metrics row already carries a Model pill (or a Models pill with a "+N"
  # and the full list one hover away), built from the trace's models. The
  # metadata auto-pin sweep promotes every `metadata.*` attribute onto the
  # pinned-context strip, and the trace-summary fold stamps `metadata.model`
  # and `metadata.models` into that namespace, so the same fact landed a second
  # time one row lower, with the list rendered as a raw JSON array. Auto-pins
  # are computed per render and carry no unpin affordance, so a reader could
  # not get rid of the copy. A reviewer who pins the key themselves still gets
  # their own pin: that is a choice, not a duplicate the drawer imposed.
  #
  # Implementation:
  #   packages/features/trace/web/src/ui/sections/explorer/trace-drawer/drawer-header/drawer-header.tsx

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace carrying the attributes "metadata.model", "metadata.models" and "metadata.environment"

  @integration
  Scenario: The model metadata keys are not auto-pinned under the Model pill
    When the trace drawer opens
    Then the pinned-context strip carries an auto-pin for "metadata.environment"
    And it carries no pin for "metadata.model"
    And it carries no pin for "metadata.models"

  @integration
  Scenario: A reviewer who pinned the model key keeps their own pin
    Given the reviewer pinned "metadata.model" from the attributes table
    When the trace drawer opens
    Then the pinned-context strip carries their pin for "metadata.model"
    And the pin can be removed the way any pin they made can
