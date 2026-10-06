Feature: PostHog guided onboarding events
  As the team running the guided onboarding experiment
  I want every server-side step of the guided onboarding captured in PostHog against the user
  And the existing product milestones split by onboarding variant
  So that the guided and the classic onboarding can be compared on one funnel

  Background:
    Given the PostHog events channel captures server-side product events with the user id as the distinct id
    And every write of an organization's guided onboarding state is recorded as a fact by the guided onboarding service, and nurturing sends it through that channel
    And the nurturing delivery turns the product milestones into PostHog events against the organization admin

  # ============================================================================
  # Variant assignment
  # ============================================================================

  # The assignment is recorded on the organization when it is created. No
  # separate exposure event is tracked: every guided onboarding event sets the
  # onboarding_variant person property and carries the experiment property.

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
    Given the PostHog channel cannot read its product-analytics targets
    When a guided onboarding event is tracked
    Then the track returns normally

  @unit
  Scenario: a guided state write reaches PostHog through the service
    Given an organization initialized with the guided variant
    When the user records the paths gateway then llmops
    Then a "guided_onboarding_paths_selected" event is tracked for that user with primary_path gateway and the organization id

  # ============================================================================
  # Existing milestones split by variant
  # ============================================================================

  # first_trace_integrated and the other milestones do not carry the variant:
  # they carry what the milestone is about. scenario_created carries the variant
  # and the experiment property; scenario_run_succeeded carries the latter.

  @unit
  Scenario: first_trace_integrated carries the SDK of the first trace and no onboarding variant
    Given a project whose first real trace was ingested from the Python SDK
    When the first trace milestone is delivered
    Then the "first_trace_integrated" event is tracked against the organization admin with sdk_language python and the project id
    And it carries no onboarding_variant and no experiment property

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

  # ============================================================================
  # PostHog experiment without feature flags
  # ============================================================================

  # The experiment is analysed in PostHog without a PostHog feature flag: the
  # organization keeps the assignment, the exposure event and every metric
  # event carry the variant under $feature/experiment_onboarding_langy_guided,
  # with the classic onboarding named control.

  @unit
  Scenario: the experiment property maps the guided variant to guided and the classic variant to control
    Given the experiment property helper
    When it is asked for the guided variant
    Then it returns $feature/experiment_onboarding_langy_guided "guided"
    When it is asked for the classic variant
    Then it returns $feature/experiment_onboarding_langy_guided "control"
    When it is asked for no variant
    Then it returns no property

  @unit
  Scenario: every guided onboarding event carries the experiment property
    Given a guided onboarding event "paths_selected"
    Then the tracked event carries $feature/experiment_onboarding_langy_guided "guided"

  @integration
  Scenario: scenario_created carries the experiment property
    Given a project whose organization was initialized with the guided variant
    When a scenario is created through the scenarios procedure
    Then the "scenario_created" event carries $feature/experiment_onboarding_langy_guided "guided"

  # ============================================================================
  # scenario_run_succeeded
  # ============================================================================

  @unit
  Scenario: a scenario run that finished against a connected agent is tracked as succeeded
    Given a scenario run against a connected agent finishes with the verdict success
    Then a "scenario_run_succeeded" event is tracked against the organization admin
    And it carries scenario_id, run_id, connected_agent true and the experiment property

  @unit
  Scenario: a scenario run whose verdict is failed still counts as succeeded
    Given a scenario run against a connected agent finishes with the verdict failure
    Then a "scenario_run_succeeded" event is tracked

  @unit
  Scenario: a scenario run that ended in an error is not tracked as succeeded
    Given a scenario run against a connected agent finishes with the status ERROR
    Then no "scenario_run_succeeded" event is tracked

  @unit
  Scenario: a scenario run against anything but a connected agent is not tracked as succeeded
    Given a scenario run against a prompt finishes with the verdict success
    Then no "scenario_run_succeeded" event is tracked

  @unit
  Scenario: the finished run event carries the target the run was queued with
    Given a run queued against a connected agent
    When the run finishes
    Then the finished event carries the connected target

  # ============================================================================
  # project_active_day
  # ============================================================================

  # Nothing in the product produces a project_active_day signal yet. What exists
  # is its delivery: a signal handed to the nurturing delivery reaches PostHog.

  @unit
  Scenario: an active-day signal reaches PostHog with its source, its signup age and the experiment property
    Given a project_active_day signal for the organization admin with source "trace", 3 days since signup and the guided variant
    When the signal is delivered
    Then a "project_active_day" event is tracked against the organization admin
    And it carries source "trace", days_since_signup 3, the project id and the experiment property "guided"
    And Customer.io receives nothing

  @unit
  Scenario: an active-day signal without a signup age or a variant carries neither
    Given a project_active_day signal with source "scenario_run", no signup age and no variant
    When the signal is delivered
    Then the "project_active_day" event carries source "scenario_run" and the project id only

  # ============================================================================
  # guided_onboarding_turn_failed
  # ============================================================================

  @unit
  Scenario: a failed Langy turn of the guided conversation is tracked with its code and path
    Given a guided onboarding conversation on the gateway path
    When one of its turns fails with the code langy_github_not_connected
    Then a "guided_onboarding_turn_failed" event is tracked against the user of the conversation
    And it carries code langy_github_not_connected, path gateway and the experiment property

  @unit
  Scenario: a turn that ended in failure with a partial answer is tracked as failed
    Given a guided onboarding conversation
    When one of its turns ends with the outcome failed
    Then a "guided_onboarding_turn_failed" event is tracked

  @unit
  Scenario: a failed turn of an ordinary conversation tracks nothing
    Given a conversation that is not the organization's guided conversation
    When one of its turns fails
    Then no "guided_onboarding_turn_failed" event is tracked

  # ============================================================================
  # Client registration
  # ============================================================================

  @integration
  Scenario: the browser registers the experiment property once the organization's variant is known
    Given a signed-in user whose organization recorded the guided variant
    When the app identifies the user
    Then posthog-js registers $feature/experiment_onboarding_langy_guided "guided"

  @integration
  Scenario: the browser registers nothing for an organization without a variant
    Given a signed-in user whose organization predates the experiment
    When the app identifies the user
    Then posthog-js registers no experiment property
    And the property is cleared, so a switch from an organization with a variant carries nothing over

  @unit
  Scenario: the registration clears the property for an organization without a variant
    Given the experiment property was registered for a previous organization
    When the registration runs with no variant
    Then posthog-js unregisters $feature/experiment_onboarding_langy_guided

  @integration
  Scenario: the welcome flow registers the experiment property as soon as the organization is created
    Given a user leaving the tailor step of the guided welcome flow
    When the organization is created
    Then posthog-js registers $feature/experiment_onboarding_langy_guided "guided"
