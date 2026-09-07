Feature: PostHog guided onboarding events
  As the team running the guided onboarding experiment
  I want every server-side step of the guided onboarding captured in PostHog against the user
  And the existing product milestones split by onboarding variant
  So that the guided and the classic onboarding can be compared on one funnel

  Background:
    Given trackServerEvent captures server-side product events with the user id as the distinct id
    And every write of an organization's guided onboarding state emits one event through onGuidedOnboardingEvent
    And the analytics subscriber attached there turns each event into a PostHog event

  # ============================================================================
  # Variant assignment
  # ============================================================================

  @unit
  Scenario: initializing an organization tracks the assigned onboarding variant
    When a user initializes an organization with the guided variant
    Then an "onboarding_variant_assigned" event is tracked for that user with variant "guided"
    And the person property onboarding_variant is set to "guided"

  @integration
  Scenario: initializing an organization through the procedure tracks the assigned onboarding variant
    When a user initializes an organization with the guided variant through the onboarding procedure
    Then an "onboarding_variant_assigned" event is captured for that user with variant "guided"

  @integration
  Scenario: initializing an organization without a variant tracks no variant assignment
    When a user initializes an organization without an onboarding variant
    Then no "onboarding_variant_assigned" event is tracked

  # ============================================================================
  # Guided onboarding steps
  # ============================================================================

  @unit
  Scenario: selecting paths tracks the paths and the primary path
    Given a guided onboarding event "paths_selected" for the paths gateway then llmops
    Then a "guided_onboarding_paths_selected" event is tracked for the user
    And it carries paths gateway and llmops and primary_path gateway

  @unit
  Scenario: connecting a provider tracks the provider and the model, never a key
    Given a guided onboarding event "provider_connected" for the provider openai with the model gpt-5
    Then a "guided_onboarding_provider_connected" event is tracked with provider openai and model gpt-5
    And no property of the event carries an API key

  @unit
  Scenario: skipping the provider is tracked
    Given a guided onboarding event "provider_skipped"
    Then a "guided_onboarding_provider_skipped" event is tracked for the user

  @unit
  Scenario: completing, skipping and replaying the tour are tracked with the current path
    Given a guided onboarding state whose current path is gateway
    When the tour is completed
    Then a "guided_onboarding_tour_completed" event is tracked with path gateway
    When the tour is skipped
    Then a "guided_onboarding_tour_skipped" event is tracked with path gateway
    When the tour is replayed
    Then a "guided_onboarding_tour_replayed" event is tracked with path gateway

  @unit
  Scenario: beginning and completing a path are tracked with the path
    Given a guided onboarding event "path_begun" for governance
    Then a "guided_onboarding_path_begun" event is tracked with path governance
    Given a guided onboarding event "path_completed" for governance
    Then a "guided_onboarding_path_completed" event is tracked with path governance

  @unit
  Scenario: attaching a conversation tracks nothing
    Given a guided onboarding event "conversation_attached"
    Then no PostHog event is tracked

  @unit
  Scenario: every guided event sets the onboarding person properties
    Given a guided onboarding event for a state with the paths gateway then llmops
    Then the tracked event sets the person properties onboarding_variant "guided", onboarding_paths gateway and llmops, and onboarding_primary_path gateway

  @unit
  Scenario: a write through a project credential is tracked against the organization admin
    Given a guided onboarding event with no user, written through a project credential
    And the organization has an admin
    Then the event is tracked with the admin's user id as the distinct id

  @unit
  Scenario: a write through a project credential of an organization without an admin tracks nothing
    Given a guided onboarding event with no user
    And the organization has no admin
    Then no PostHog event is tracked

  @unit
  Scenario: a failing analytics call never fails the write
    Given the PostHog client throws on capture
    When a guided onboarding event is emitted
    Then the emit returns normally
    And the failure is captured for observability

  @integration
  Scenario: a guided state write through the procedure reaches PostHog
    Given an organization initialized with the guided variant
    When the user records the paths gateway then llmops through the onboarding procedure
    Then a "guided_onboarding_paths_selected" event is captured for that user with primary_path gateway

  # ============================================================================
  # Existing milestones split by variant
  # ============================================================================

  @unit
  Scenario: first_trace_integrated carries the onboarding variant of the organization
    Given a project whose organization was initialized with the guided variant
    When its first real trace is ingested
    Then the "first_trace_integrated" event carries onboarding_variant "guided"

  @unit
  Scenario: first_trace_integrated carries no onboarding variant when the organization recorded none
    Given a project whose organization predates the experiment
    When its first real trace is ingested
    Then the "first_trace_integrated" event carries no onboarding_variant property

  @unit
  Scenario: the organization admin resolution reads the onboarding variant next to the admin
    Given a project whose organization recorded the classic variant
    When the organization admin is resolved for that project
    Then the resolution carries onboardingVariant "classic"

  @integration
  Scenario: scenario_created carries the onboarding variant of the organization
    Given a project whose organization was initialized with the guided variant
    When a scenario is created through the scenarios procedure
    Then the "scenario_created" event carries onboarding_variant "guided"

  @unit
  Scenario: the onboarding checks expose the guided state of the organization
    Given a project whose organization recorded the guided variant with the paths gateway then llmops and gateway done
    When the onboarding check status is read for that project
    Then it carries guidedOnboarding with variant "guided", paths gateway and llmops, currentPath llmops and donePaths gateway

  @unit
  Scenario: the onboarding checks expose the empty guided state for an organization that recorded none
    Given a project whose organization predates the experiment
    When the onboarding check status is read for that project
    Then it carries guidedOnboarding with no variant, no paths and no done paths

  @integration
  Scenario: the onboarding progress view carries the onboarding variant
    Given the onboarding check status of the project carries the guided variant
    When the onboarding progress card loads
    Then the "viewed onboarding_progress" event carries onboarding_variant "guided"
