Feature: Customer.io guided onboarding traits and campaign triggers
  As the marketing team
  I want the picks and the progress of a guided onboarding pushed to Customer.io
  So that one campaign per path can run from the moment the path is picked

  Background:
    Given nurturing hooks fire and forget through the app's nurturing service
    And every write of an organization's guided onboarding state emits one event through onGuidedOnboardingEvent
    And the nurturing subscriber attached there turns each event into Customer.io calls

  # ============================================================================
  # Picking paths
  # ============================================================================

  @unit
  Scenario: selecting paths identifies the user with the onboarding traits
    Given a guided onboarding event "paths_selected" for the paths gateway then llmops
    Then the user is identified with onboarding_variant "guided", onboarding_paths "gateway,llmops" and onboarding_primary_path "gateway"

  @unit
  Scenario: selecting paths pushes the same traits to the organization group
    Given a guided onboarding event "paths_selected" for the paths gateway then llmops
    Then the organization group carries onboarding_variant "guided", onboarding_paths "gateway,llmops" and onboarding_primary_path "gateway"

  @unit
  Scenario: selecting paths fires the paths event with the paths and the primary path
    Given a guided onboarding event "paths_selected" for the paths gateway then llmops
    Then an "onboarding_paths_selected" event is tracked with paths "gateway,llmops" and primary_path "gateway"

  @unit
  Scenario: selecting paths fires one campaign trigger per path, once each
    Given a guided onboarding event "paths_selected" for the paths gateway, llmops and coding
    Then exactly one "onboarding_path_gateway" event is tracked
    And exactly one "onboarding_path_llmops" event is tracked
    And exactly one "onboarding_path_coding_agents" event is tracked
    And no "onboarding_path_governance" event is tracked

  @unit
  Scenario: beginning a path the user never picked fires that path's campaign trigger
    Given a guided onboarding state that lists llmops
    When the user begins the governance path
    Then exactly one "onboarding_path_governance" event is tracked
    And no "onboarding_path_llmops" event is tracked again

  @unit
  Scenario: beginning a path the user already picked fires no campaign trigger
    Given a guided onboarding state that lists gateway then llmops
    When the user begins the llmops path
    Then no path campaign trigger is tracked

  # ============================================================================
  # Progress
  # ============================================================================

  @unit
  Scenario: connecting a provider identifies the provider, never a key
    Given a guided onboarding event "provider_connected" for the provider openai with the model gpt-5
    Then the user is identified with guided_onboarding_provider "openai"
    And no trait carries an API key

  @unit
  Scenario: completing the tour identifies the tour as completed
    Given a guided onboarding event "tour_completed"
    Then the user is identified with guided_onboarding_tour "completed"

  @unit
  Scenario: skipping the tour identifies the tour as skipped
    Given a guided onboarding event "tour_skipped"
    Then the user is identified with guided_onboarding_tour "skipped"

  @unit
  Scenario: completing a path identifies the completed paths and fires the completion event
    Given a guided onboarding event "path_completed" for gateway, with gateway and llmops done
    Then the user is identified with guided_onboarding_completed_paths "gateway,llmops" and guided_onboarding_completed_at set
    And the organization group carries guided_onboarding_completed_paths "gateway,llmops"
    And a "guided_onboarding_path_completed" event is tracked with path "gateway"

  @unit
  Scenario: skipping the provider, replaying the tour and attaching a conversation send nothing
    Given a guided onboarding event "provider_skipped", "tour_replayed" or "conversation_attached"
    Then no Customer.io call is made

  # ============================================================================
  # Attribution, absence of a key, failures, backfill
  # ============================================================================

  @unit
  Scenario: a write through a project credential is attributed to the organization admin
    Given a guided onboarding event with no user, written through a project credential
    And the organization has an admin
    Then the Customer.io calls are made for the admin's user id

  @unit
  Scenario: without a Customer.io key nothing is sent
    Given the app has no nurturing service
    When a guided onboarding event is emitted
    Then no Customer.io call is made

  @unit
  Scenario: a Customer.io failure never fails the write
    Given the Customer.io API is unavailable
    When a guided onboarding event is emitted
    Then the emit returns normally
    And the failure is captured for observability

  @unit
  Scenario: the first login backfill carries the onboarding traits
    Given a user whose organization recorded the guided variant, the paths gateway then llmops, the provider openai, a completed tour and gateway done
    When the user's profile is synced to Customer.io on first login
    Then the identify call carries onboarding_variant "guided", onboarding_paths "gateway,llmops", onboarding_primary_path "gateway", guided_onboarding_provider "openai", guided_onboarding_tour "completed" and guided_onboarding_completed_paths "gateway"
    And the organization group carries onboarding_variant "guided", onboarding_paths "gateway,llmops" and onboarding_primary_path "gateway"

  @unit
  Scenario: the first login backfill of an organization that predates the experiment carries no onboarding traits
    Given a user whose organization recorded no onboarding variant
    When the user's profile is synced to Customer.io on first login
    Then the identify call carries no onboarding trait

  @integration
  Scenario: a guided state write through the procedure reaches Customer.io
    Given an organization initialized with the guided variant
    When the user records the paths gateway then llmops through the onboarding procedure
    Then the user is identified with onboarding_primary_path "gateway"
    And an "onboarding_path_gateway" event and an "onboarding_path_llmops" event are tracked for that user
