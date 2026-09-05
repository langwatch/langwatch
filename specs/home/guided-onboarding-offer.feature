# The orange pill under the search bar of a day-zero home in the guided
# onboarding variant: "Start guided onboarding". One per space (the project
# home for LLM Ops, the gateway home, the governance home, /me for coding
# agents). Clicking it begins that space's path on the organization, runs the
# path's tour if it has one, and queues the Langy kickoff that continues the
# conversation the guided onboarding already attached.
#
# Spec of the tour itself: specs/features/onboarding/guided-tour.feature.
# Spec of the guided state: specs/features/onboarding/guided-onboarding-variant.feature.
Feature: Guided onboarding offer on the home pages
  As a new user in the guided onboarding variant
  I want every space I land in to offer to walk me through it
  So that the paths I picked, and the ones I wander into, all get set up by Langy

  Background:
    Given the organization is in the guided onboarding variant
    And the project has no traces yet

  # ============================================================================
  # Where and when the offer shows
  # ============================================================================

  @unit
  Scenario: the offer shows on the project home under the search bar
    When the project home renders
    Then a pill reading "Start guided onboarding" is under the search field

  @unit
  Scenario: the offer shows on the gateway, governance and personal homes
    When the gateway home renders
    Then the pill offers the gateway path
    When the governance home renders
    Then the pill offers the governance path
    When the personal home renders
    Then the pill offers the coding path

  @unit
  Scenario: the gateway, governance and personal homes read the organization's guided state
    Given the governance home renders with some project ambient
    Then the pill reads the organization's guided state rather than that project's checks
    And it shows whether or not the ambient project has traces
    And it is still hidden once governance is done

  @unit
  Scenario: the offer is hidden while Langy is guiding that same space
    Given the current path is llmops
    When the project home renders
    Then there is no pill

  @unit
  Scenario: the offer is hidden once the space is done
    Given the done paths include gateway
    When the gateway home renders
    Then there is no pill

  @unit
  Scenario: the offer is hidden while a tour is on screen
    Given the gateway tour is running
    When the gateway home renders
    Then there is no pill

  @unit
  Scenario: a path picked on the value screen but not started yet is offered in its space
    Given the picked paths are llmops then gateway
    And the current path is llmops
    When the gateway home renders
    Then the pill offers the gateway path

  @unit
  Scenario: a space the user never picked is offered too
    Given the picked paths are llmops only
    When the governance home renders
    Then the pill offers the governance path

  @unit
  Scenario: the offer is hidden on a project that already has traces
    Given the project has traces
    When the project home renders
    Then there is no pill

  @unit
  Scenario: the classic variant never shows the offer
    Given the organization is not in the guided onboarding variant
    When the project home renders
    Then there is no pill

  # ============================================================================
  # What clicking it does
  # ============================================================================

  @unit
  Scenario: clicking the offer begins the path and runs its tour
    Given the gateway home shows the pill
    When the user clicks it
    Then the gateway path is begun on the organization
    And the Langy panel opens docked
    And the gateway tour starts from step 1
    And "clicked home_offer" is emitted with the path

  @unit
  Scenario: the kickoff continues the attached conversation when the tour ends
    Given a conversation is attached to the guided onboarding
    And the user clicked the gateway offer
    When the gateway tour ends
    Then one kickoff for the gateway path is queued, continuing that conversation

  @unit
  Scenario: the coding offer queues the kickoff with no tour
    Given the personal home shows the pill
    When the user clicks it
    Then the coding path is begun on the organization
    And no tour runs
    And the kickoff for the coding path is queued right away

  @unit
  Scenario: the offer is disabled while the path is being begun
    Given the user clicked the pill
    While the begin request is in flight
    Then the pill cannot be clicked again

  @unit
  Scenario: a failed begin keeps the offer and shows the error
    Given the begin request fails with a handled error
    When the user clicks the pill
    Then the pill stays
    And the error is shown as a toast with the code's copy
