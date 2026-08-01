Feature: Onboarding forks on declared intent — Agent Governance vs LLMOps
  A new user signing up either wants to track their team's AI coding-tool
  usage and spend (Agent Governance) or to monitor and evaluate an LLM app
  they are building (LLMOps). Today's onboarding only serves the second
  intent; governance users answer a long LLMOps questionnaire and end up
  in the wrong surface.

  The welcome flow gains an intent screen right after organization
  creation. The governance track ends right there — finishing creates the
  workspace and lands on the personal usage page, where the existing CLI
  install surfaces teach setup (ADR-038 v4: onboarding touches no
  CLI-related screen or component). The LLMOps track continues exactly as
  today. The choice is stored on the organization as its primary intent.

  ADR: dev/docs/adr/038-intent-forked-onboarding-governance-vs-llmops.md
  Pairs with:
    - specs/ai-gateway/governance/org-intent-home-resolution.feature (landing rule)
    - specs/features/onboarding/primary-use-setting.feature (editing later)

  Background:
    Given a newly signed-up user with no organization

  # ============================================================================
  # Ships dark: the whole fork is gated by the governance feature flag (v5)
  # ============================================================================

  Rule: without the governance flag, onboarding is exactly the pre-fork flow

    @unit
    Scenario: With the fork disabled the flow is exactly the pre-fork one
      Given the governance feature flag is off for the user
      When the welcome flow computes its screens
      Then no intent screen exists anywhere in the flow
      And the screens match the pre-fork flow exactly, on SaaS and self-hosted

  # ============================================================================
  # The intent screen (screen 2)
  # ============================================================================

  Rule: the intent question comes right after organization creation, before any track-specific question

    @integration
    Scenario: Intent screen appears as the second step
      Given the user completed the organization screen
      When the welcome flow advances
      Then the user sees the intent screen with exactly two options
      And one option is about tracking the team's AI coding-tool usage and spend
      And the other option is about tracing and evaluating an LLM app they are building

    @integration
    Scenario: Coding-agent product builders are steered to the LLMOps card
      When the user reads the two intent cards
      Then the governance card speaks of tracking usage and spend of coding tools the team uses
      And the LLMOps card explicitly includes LLM apps and coding agents the user is building
      # Guards the S1 misroute: someone SHIPPING a coding agent wants LLMOps.
      # Exact copy is pinned by this test per copywriting standards.

    @unit
    Scenario: Intent screen is required
      Given the user is on the intent screen
      When the user has not selected an intent
      Then the user cannot proceed to the next step

  # ============================================================================
  # Governance track
  # ============================================================================

  Rule: the governance track ends at the intent screen — no LLMOps questionnaire, no extra steps

    @unit
    Scenario: Governance track has no screens after the intent
      Given the user selected the coding-agent tracking intent
      When the flow computes the remaining screens
      Then the intent screen is the final step
      And the basic-info, desires, and role screens are not part of the track

    @integration @unimplemented
    Scenario: Finishing the governance track lands on the personal usage page
      Given the user selected the coding-agent tracking intent
      When onboarding finishes
      Then the user is taken to their personal usage page
      And the CLI setup guidance they see there is the existing personal-page surface, unchanged by onboarding

  Rule: the governance track provisions the organization without a shared project (v6)

    @unit
    Scenario: Governance signup creates organization and team, but no shared project
      Given the user selected the coding-agent tracking intent
      When onboarding completes
      Then an organization and a team exist for the user
      And no shared project was created
      # A shared project is created only when the organization later switches
      # its primary use to LLMOps.

    @unit
    Scenario: LLMOps signup still creates the default project
      Given the user selected the LLM-app intent
      When onboarding completes
      Then an organization, a team, and a default project exist for the user

  Rule: the governance track provisions the signer's personal workspace

    # Coding-agent usage lands in a personal workspace, so /me is empty until
    # one exists. Waiting for the first CLI login meant the page the track
    # ends on could only tell the user to go install something. Provisioning
    # it with the organization means the destination is real on arrival.
    #
    # This supersedes ADR-038 v6's "provisioned lazily at CLI login" for the
    # onboarding path. CLI login still provisions on its own, unchanged and
    # still idempotent, so a user who signs up on one machine and logs in on
    # another gets the same single workspace either way.

    @unit
    Scenario: Governance signup provisions the personal workspace
      Given the user selected the coding-agent tracking intent
      When onboarding completes
      Then the user has a personal workspace in the new organization

    @unit
    Scenario: The personal workspace stays separate from the shared workspace
      Given the user selected the coding-agent tracking intent
      When onboarding completes
      Then the personal project is marked personal and owned by the signer
      And the organization's shared team is not the personal one

    @unit
    Scenario: Failing to provision the workspace does not cost the user their organization
      Given the user selected the coding-agent tracking intent
      And provisioning the personal workspace fails
      When onboarding completes
      Then the organization and team still exist
      And onboarding reports success
      # The next session backfills the workspace, so the recovery is a page
      # load rather than a support ticket.

    @unit
    Scenario: LLMOps signup provisions no personal workspace
      Given the user selected the LLM-app intent
      When onboarding completes
      Then no personal workspace was provisioned
      # Nothing on the LLMOps track reads one, and CLI login still creates it
      # for whoever later goes looking.

    @integration
    Scenario: Governance signup records the organization's primary intent
      Given the user selected the coding-agent tracking intent
      When onboarding completes
      Then the organization's primary intent is agent governance
      And the intent was recorded together with the organization creation, not as a separate step that can fail on its own

  # ============================================================================
  # LLMOps track
  # ============================================================================

  Rule: the LLMOps track behaves exactly as today's onboarding after the intent screen

    @unit
    Scenario: LLMOps track keeps today's screens in today's order
      Given the user selected the LLM-app intent
      When the flow computes the remaining screens
      Then the remaining screens are basic-info, desires, and role, in that order
      And the desires and role screens remain skippable

    @integration
    Scenario: LLMOps signup produces the same marketing data as today
      Given the user selected the LLM-app intent
      And the user answered the basic-info, desires, and role screens
      When onboarding completes
      Then the recorded signup marketing data is identical to what today's flow records
      And the organization's primary intent is LLMOps

    @integration @unimplemented
    Scenario: LLMOps track continues to the flavour selection as today
      Given the user selected the LLM-app intent
      When the welcome screens complete
      Then the user reaches the flavour selection for their project as today

  # ============================================================================
  # Segmentation and instrumentation
  # ============================================================================

  Rule: every signup is segmentable by intent from day one

    @integration
    Scenario: Nurturing receives the intent as an explicit trait
      Given a user completes onboarding on either track
      When the signup nurturing hooks fire
      Then the primary intent is included as an explicit trait

    @integration @unimplemented
    Scenario: Funnel analytics carry the intent on every screen event
      Given a user selected an intent
      When any subsequent onboarding screen emits an analytics event
      Then the event carries the selected intent
      # Anchors the conversion revert trigger: per-track completion must be
      # measurable against the pre-release baseline.

  # ============================================================================
  # Self-hosted parity
  # ============================================================================

  Rule: self-hosted installs get the same fork

    @unit
    Scenario: Self-hosted welcome includes the intent screen
      Given the app runs in self-hosted mode
      When a new user goes through the welcome flow
      Then the intent screen appears after the organization screen
      # Self-hosted endpoint guidance for the CLI remains where it already
      # lives (specs/ai-governance/cli-onboarding/install-cli-card.feature);
      # onboarding renders no CLI commands.
