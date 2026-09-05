Feature: Guided onboarding variant
  As the team running the guided onboarding experiment
  I want each new user assigned to the guided or the classic onboarding in a sticky way
  And the guided state of an organization recorded on the server
  So that the two variants can be compared and a guided user can resume where they stopped

  Background:
    Given the feature flag "experiment_onboarding_langy_guided" is registered as a PRODUCT flag, off by default
    And the flag can be read from the frontend

  # ============================================================================
  # Variant assignment through a percentage rollout rule
  # ============================================================================

  @unit
  Scenario: a percentage rollout rule assigns a user the same variant on every read
    Given a targeting rule enabling the flag for 50% of users
    When the flag is read for the same user many times
    Then every read resolves to the same value

  @unit
  Scenario: a percentage rollout rule splits users roughly evenly
    Given a targeting rule enabling the flag for 50% of users
    When the flag is read for ten thousand distinct users
    Then close to half of them resolve enabled

  @unit
  Scenario: a percentage rollout rule never matches a read without a user
    Given a targeting rule enabling the flag for 50% of users
    When the flag is read with no distinct id
    Then the rule matches nothing, so the read falls through to the row-level default

  @unit
  Scenario: a zero percent rollout matches no user
    Given a targeting rule enabling the flag for 0% of users
    When the flag is read for any user
    Then the rule matches nothing

  @unit
  Scenario: a hundred percent rollout matches every user
    Given a targeting rule enabling the flag for 100% of users
    When the flag is read for any user
    Then the rule matches

  @unit
  Scenario: the same user lands in different buckets for different flags
    Given two flags each with a 50% rollout rule
    When both flags are read for many users
    Then the buckets are not the same for every user, because the flag key is part of the hash

  @unit
  Scenario: a percentage outside 0 to 100 cannot be written
    When an operator writes a rule with a percentage of 150
    Then the write is rejected with a message naming the valid range

  @unit
  Scenario: the ops page reads and writes a percentage rollout rule
    Given a stored rule enabling the flag for 25% of users
    When the rule is opened in the targeting rules dialog
    Then it shows as a "Percentage of users" rule with 25
    And saving it back stores the same percentage

  @unit
  Scenario: the flag reaches the store with the caller's distinct id
    Given the flag has a percentage rollout rule
    When the flag is read through the feature flag service for a user
    Then the store evaluates the rule against that user's distinct id

  # ============================================================================
  # The classic variant stays untouched, dev overrides force the guided one
  # ============================================================================

  @unit
  Scenario: the classic variant is unchanged when the flag is off
    Given the flag has no rule and no operator row
    When the flag is read for any user
    Then it resolves to false

  @unit
  Scenario: the force-enable environment variable turns the guided variant on for everyone
    Given FEATURE_FLAG_FORCE_ENABLE names "experiment_onboarding_langy_guided"
    When the flag is read for any user
    Then it resolves to true before any rule is consulted

  @unit
  Scenario: the browser query override turns the guided variant on in that browser
    Given the page is opened with "?ff_experiment_onboarding_langy_guided=on"
    When the flag is read from the frontend
    Then it resolves to true without a network call

  # ============================================================================
  # Guided state on the organization
  # ============================================================================

  @unit
  Scenario: the guided path enum carries the four paths with their titles
    Then the paths are llmops, coding, gateway and governance
    And their titles are "Evals & LLM Ops", "Coding Agent Tracking", "Gateway" and "Governance"

  @unit
  Scenario: the sign-up data schema accepts the onboarding variant and the guided state
    When sign-up data carries an onboarding variant and a guided onboarding block
    Then it parses, and the block keeps its paths in order

  @unit
  Scenario: a malformed guided state on the organization reads as the empty default
    Given an organization whose stored guided state is not the expected shape
    When the guided state is read
    Then the empty default is returned instead of an error

  @integration
  Scenario: initializing an organization records the onboarding variant
    When a user initializes an organization with the guided variant
    Then the organization's sign-up data carries onboardingVariant "guided"

  @integration
  Scenario: initializing an organization without a variant leaves the sign-up data unchanged
    When a user initializes an organization without an onboarding variant
    Then the organization's sign-up data carries no onboarding variant

  @integration
  Scenario: an organization without guided state returns the empty default
    Given an organization that never entered the guided onboarding
    When its guided state is read
    Then it has no paths, no done paths and no current path

  @integration
  Scenario: recording paths stores them in pick order and starts the first one
    Given an organization in the guided variant
    When the user records the paths gateway then llmops
    Then the guided state lists gateway before llmops
    And the current path is gateway

  @integration
  Scenario: recording a provider stores the provider and its model
    Given an organization in the guided variant
    When the user records the provider openai with the model gpt-5
    Then the guided state carries that provider and model

  @integration
  Scenario: skipping the provider is recorded
    Given an organization in the guided variant
    When the user skips the provider step
    Then the guided state carries the time the provider was skipped

  @integration
  Scenario: completing, skipping and replaying the tour are recorded
    Given an organization in the guided variant
    When the user completes the tour
    Then the guided state carries the time the tour was completed
    When the user skips the tour
    Then the guided state carries the time the tour was skipped
    When the user replays the tour twice
    Then the guided state counts two replays

  @integration
  Scenario: beginning a path makes it the current one and remembers it
    Given an organization whose guided state lists llmops
    When the user begins the governance path
    Then the current path is governance
    And governance is among the recorded paths

  @integration
  Scenario: completing a path is idempotent
    Given an organization whose current path is llmops
    When the llmops path is completed twice
    Then the done paths list llmops exactly once
    And there is no current path

  @integration
  Scenario: an unknown path is rejected with a named error
    Given an organization in the guided variant
    When a path named "billing" is completed
    Then the request fails with the code "guided_onboarding_path_unknown"

  @integration
  Scenario: attaching a conversation records its id
    Given an organization in the guided variant
    When the conversation "conv_1" is attached
    Then the guided state carries that conversation id

  @integration
  Scenario: a member of another organization cannot write the guided state
    Given a user who is not a member of the organization
    When they try to record paths for it
    Then the request is refused

  @integration
  Scenario: every guided state write reaches the onboarding event hook
    Given an organization in the guided variant
    When the user records paths
    Then the guided onboarding event hook receives a "paths_selected" event for that organization and user

  # ============================================================================
  # The CLI reaches the same state through the project's credential
  # ============================================================================

  @integration
  Scenario: the REST route reads the guided state of the project's organization
    Given a project whose organization has recorded the paths llmops and gateway
    When the guided state is requested with that project's credential
    Then the answer lists llmops and gateway

  @integration
  Scenario: the REST route completes a path for the project's organization
    Given a project whose organization has the current path llmops
    When the llmops path is completed with that project's credential
    Then the organization's done paths list llmops

  @unit
  Scenario: the CLI prints the guided state as JSON
    When "langwatch onboarding state" runs
    Then it resolves credentials first and prints the state the platform answered

  @unit
  Scenario: the CLI completes a path by name
    When "langwatch onboarding complete-path llmops" runs
    Then it asks the platform to complete the llmops path and prints the updated state

  @unit
  Scenario: the CLI boot graph does not change for the onboarding commands
    When the CLI starts
    Then the onboarding command modules are not loaded until the command runs
