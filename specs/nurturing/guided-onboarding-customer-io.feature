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
  # Langy's governance start
  # ============================================================================

  @unit
  Scenario: Langy's start choice reaches nurturing as a guided progress signal
    Given guided onboarding records a "start_chosen" event with the start call
    Then nurturing raises a guided onboarding progress signal carrying the start call

  @unit
  Scenario: choosing the coding start identifies the start and tracks the choice
    Given a guided onboarding event "start_chosen" for the start coding
    Then the user is identified with langy_start "coding"
    And a "langy_start_chosen" event is tracked with start "coding"

  @unit
  Scenario: choosing the call start records the choice, never a booking
    Given a guided onboarding event "start_chosen" for the start call
    Then the user is identified with langy_start "call"
    And a "langy_start_chosen" event is tracked with start "call"
    And no trait or event says a call was booked

  @unit
  Scenario: a start that is neither coding nor call sends nothing
    Given a guided onboarding event "start_chosen" for the start "meeting"
    Then no Customer.io call is made

  @unit
  Scenario: the backfill carries the start the state holds
    Given a guided onboarding state that lists governance with the start call
    Then the person traits it reads as carry langy_start "call"

  # ============================================================================
  # The variant, and the first-login backfill
  # ============================================================================

  @unit
  Scenario: the assigned experiment variant reaches the creator and the organization
    Given an organization assigned the "guided" onboarding variant
    Then its creator is identified with onboarding_variant "guided"
    And the organization group carries onboarding_variant "guided"
    And neither carries onboarding_primary_path, since no path is picked yet

  # No backfill recovers the variant of an organization that picks no path, so a refused
  # send must retry rather than leave the trait empty.
  @unit
  Scenario: a refused variant assignment fails its delivery, so its job retries
    Given an organization assigned the "guided" onboarding variant
    And Customer.io refuses the variant assignment
    When the delivery is retried after Customer.io recovers
    Then its creator is identified with onboarding_variant "guided"
    And the organization group carries onboarding_variant "guided"

  @unit
  Scenario: a login backfills the picked paths of the person's latest organization, once
    Given a member whose latest organization picked gateway then llmops in the guided variant
    When their session starts twice
    Then they are identified once with onboarding_primary_path "gateway" and onboarding_paths "gateway,llmops"
    And the organization group carries onboarding_primary_path "gateway" once

  @unit
  Scenario: a backfill sends the state read after its claim
    Given a member whose latest organization picked gateway in the guided variant
    And another member picks llmops first while the backfill takes its claim
    When their session starts
    Then they are identified with onboarding_primary_path "llmops"
    And the organization group carries onboarding_primary_path "llmops"

  # The claim is taken before any read, so every later login of a settled person costs one
  # claim, not a membership read and an organization read.
  @unit
  Scenario: a sent backfill reads nothing on a later login
    Given a member whose backfill was sent
    When their session starts again after the attempt's hour has passed
    Then the organization's guided state is not read
    And no Customer.io call is made

  @unit
  Scenario: a login before any pick sends no backfill and keeps it for a later login
    Given a member whose latest organization picked no path yet
    When their session starts
    Then no Customer.io call is made
    When the organization picks governance and their session starts again
    Then they are identified with onboarding_primary_path "governance"

  @unit
  Scenario: a backfill whose send fails is sent on the next login
    Given a member whose latest organization picked gateway in the guided variant
    And Customer.io refuses the first backfill
    When their session starts twice
    Then the second session sends the backfill

  @unit
  Scenario: a backfill whose send and claim release both fail is sent on a later login
    Given a member whose latest organization picked gateway in the guided variant
    And Customer.io refuses the first backfill
    And giving its claim back fails
    When their session starts again after the attempt's hour has passed
    Then that session sends the backfill

  @unit
  Scenario: an organization with picks but no variant sends no backfill
    Given a member whose latest organization picked gateway but carries no variant
    When their session starts
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

  @integration
  Scenario: a guided state write through the procedure reaches Customer.io
    Given an organization initialized with the guided variant
    When the user records the paths gateway then llmops through the onboarding procedure
    Then the user is identified with onboarding_primary_path "gateway"
    And an "onboarding_path_gateway" event and an "onboarding_path_llmops" event are tracked for that user
