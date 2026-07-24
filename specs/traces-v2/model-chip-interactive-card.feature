# Multi-model chip — interactive model card
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceTable/registry/cells/trace/ModelCell.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/drawerHeader/DrawerHeader.tsx  (ModelsTooltip consumer)
#   langwatch/src/features/traces-v2/stores/filterStore.ts  (toggleFacet)
#
# Motivation (round 5): a trace that touched several models renders one
# chip — primary model + a quiet "+N". The full list lives in a
# *Tooltip* (`ModelsTooltip`) that was deliberately made click-transparent
# so the chip's own click-to-filter and ↗ provider link kept working; the
# trade-off is you can't move the mouse onto the list to act on an
# individual model. Round 5 makes the list an interactive card whose rows
# are each click-to-filter, WITHOUT breaking the chip body's behaviour.

Feature: Multi-model chip interactive card

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace row that used several models
    And its model cell shows the primary model with a "+N" more indicator

Rule: The chip body keeps its current click behaviour
  Decision (round 5): clicking the chip body filters by the PRIMARY model
  only — unchanged. Bulk filtering moves into the interactive card.

  Scenario: Clicking the chip body filters by the primary model
    When the user clicks the chip body
    Then the trace list filters by the primary (first) model only
    And no filter is added for the other models in the chip

  Scenario: The provider link still opens model settings
    When the user activates the chip's ↗ open affordance
    Then model-provider settings open for the primary model
    And no filter is toggled by that action

Rule: The model list is an interactive card the mouse can enter
  The hover list becomes a card the pointer can move into (it no longer
  dismisses when the mouse leaves the chip toward it), with each model
  on its own clickable row.

  Scenario: Moving the mouse onto the card keeps it open
    When the user hovers the chip and moves the pointer onto the card
    Then the card stays open while the pointer is over it

  Scenario: Clicking a model row filters by that single model
    Given the model card is open showing each model on its own row
    When the user clicks one model row
    Then the trace list filters by that single model
    And the other models in the chip are not added to the filter

  Scenario: A single-model cell shows no card
    Given a trace row whose `models` list has exactly one model
    Then the cell renders the model with no "+N" suffix
    And no model card is offered
