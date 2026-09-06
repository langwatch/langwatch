Feature: Guided welcome flow and takeover screens
  As a person who just signed up in the guided onboarding variant
  I want Langy to take over the screen after the first two questions
  So that I pick what to set up and connect a provider before landing in the product

  # The screens after "tailor your experience" are Langy speaking: a typed
  # greeting, a multi-pick value question and a provider connect step. The
  # organization and the project exist before the takeover starts, and every
  # answer is written to the organization so a reload continues where it was.
  #
  # Tests:
  #   platform/app/src/features/onboarding/constants/onboarding-flow.unit.test.ts
  #   platform/app/src/features/guided-onboarding/__tests__/paths.unit.test.ts
  #   platform/app/src/features/onboarding/screens/__tests__/WelcomeScreen.guided.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/GuidedTakeover.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/HelloScreen.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/ValueScreen.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/ProviderScreen.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/useGuidedProviderConnect.integration.test.tsx
  #   platform/app/src/features/guided-onboarding/takeover/__tests__/takeover.analytics.integration.test.tsx

  Background:
    Given I signed up and the "experiment_onboarding_langy_guided" flag resolves enabled for me

  # ============================================================================
  # The screens and their order
  # ============================================================================

  @unit
  Scenario: The guided flow shows the organization, tailor, hello, value and provider screens in that order
    When the welcome flow is configured for the guided variant
    Then the screens are organization, tailor, hello, value and provider
    And the intent, desires and role screens are not among them

  @unit
  Scenario: A self-hosted install gets the same guided screens
    When the welcome flow is configured for the guided variant on a self-hosted install
    Then the screens are organization, tailor, hello, value and provider

  @unit
  Scenario: The classic flow is untouched when the flag is off
    When the welcome flow is configured for the classic variant
    Then the screens are exactly the ones the classic wizard had

  @integration
  Scenario: The classic variant creates the organization at the end of the wizard
    Given the flag resolves disabled for me
    When I leave the tailor step
    Then no organization is created yet
    And the wizard continues to its next screen

  # ============================================================================
  # Organization and tailor steps
  # ============================================================================

  @integration
  Scenario: The tailor step starts with nothing selected and expands for a company
    Given I created my organization
    When the tailor step opens
    Then none of Company, Clients and Myself is selected
    When I pick Company
    Then I am asked for my phone number, my company size and how I plan to deploy LangWatch

  @integration
  Scenario: A company cannot leave the tailor step before its size and deploy plan are picked
    Given I am on the tailor step
    When I pick Company
    Then Next stays disabled
    When I pick my company size
    Then Next stays disabled
    When I pick how I plan to deploy LangWatch
    Then Next is enabled

  @integration
  Scenario: Leaving the tailor step creates the organization and the project with the variant recorded
    Given I am on the tailor step
    When I answer it and click Next
    Then the organization and its project are created with the guided variant
    And Langy takes over the screen with the hello greeting

  @integration
  Scenario: A failed organization creation keeps the user on the tailor step
    Given I am on the tailor step
    When the organization cannot be created
    Then I see the named error
    And I stay on the tailor step with my answers intact

  # ============================================================================
  # Hello
  # ============================================================================

  @integration
  Scenario: Langy greets the user letter by letter and offers Next when the greeting lands
    Given the takeover opens on the hello screen
    Then the greeting types out "Hello Rogerio, I'm Langy 👋" and then "I'll be your guide today."
    And Next is not offered while the greeting is still typing
    When the greeting has landed
    Then Next fades in shortly after

  @integration
  Scenario: A user without a first name is greeted as "there"
    Given my account has no name
    When the hello screen opens
    Then the greeting starts with "Hello there"

  # ============================================================================
  # Value
  # ============================================================================

  @integration
  Scenario: The value question names the organization
    Given I said I use LangWatch for my company "ACME"
    When the value screen opens
    Then Langy asks "So tell me, Rogerio, what are the most valuable things we can set up for ACME today?"

  @integration
  Scenario: The value question says "you" when the user is on their own
    Given I said I use LangWatch for myself
    When the value screen opens
    Then Langy asks what to set up for "you"

  @integration
  Scenario: The four paths are offered with their titles and descriptions
    When the value screen opens
    Then I see "Evals & LLM Ops", "Coding Agent Tracking", "Gateway" and "Governance"
    And each card carries its one-line description

  @integration
  Scenario: Picking cards numbers them in pick order
    When I pick Gateway and then Evals & LLM Ops
    Then the Gateway card shows 1 and the Evals & LLM Ops card shows 2

  @integration
  Scenario: Unpicking a card renumbers the ones picked after it
    Given I picked Gateway, Evals & LLM Ops and Governance
    When I unpick Gateway
    Then Evals & LLM Ops shows 1 and Governance shows 2

  @integration
  Scenario: Next appears with the first pick
    When the value screen opens
    Then Next is not offered
    When I pick a card
    Then Next is offered
    When I unpick it again
    Then Next is not offered

  @integration
  Scenario: Leaving the value screen records the picks in order
    Given I picked Gateway and then Evals & LLM Ops
    When I click Next
    Then the organization records the paths gateway then llmops
    And the provider screen opens

  @integration
  Scenario: A failed record keeps the user on the value screen
    Given I picked a card
    When the picks cannot be recorded
    Then I see the named error
    And I stay on the value screen with my picks intact

  # ============================================================================
  # Provider
  # ============================================================================

  @integration
  Scenario: Langy says "that up" for one pick and "those up" for several
    Given I picked one path
    When the provider screen opens
    Then Langy says "Awesome! I'll help you set that up."
    Given I picked two paths
    When the provider screen opens
    Then Langy says "Awesome! I'll help you set those up."

  @integration
  Scenario: The provider marks are one row with Codex first and preselected
    When the provider screen opens
    Then the marks read Codex, OpenAI, Anthropic, Gemini, Azure, Bedrock, DeepSeek, Groq and Custom in that order
    And Codex is selected
    And the connect panel offers "Sign in with ChatGPT"

  @integration
  Scenario: An API key provider asks for the key and offers the default chat models
    When I select OpenAI
    Then the connect panel has an API key field
    And the default chat model pills show the recommended model first, marked "recommended"
    And Connect is disabled until a key is typed

  @integration
  Scenario: Azure, Bedrock and Custom take credentials and a typed model name
    When I select Azure
    Then the connect panel asks for the credentials and a chat model
    And the hint reads "Type it exactly as deployed: Azure has no model list we can read for you."
    When I select Bedrock
    Then the hint names Bedrock
    When I select Custom
    Then the hint names Custom

  @integration
  Scenario: Connecting with a key checks it and then reports Connected
    Given I selected OpenAI and typed a key
    When I click Connect
    Then the button reads "Checking the key…" while the key is checked
    And it reads "Connected" once the provider is saved

  @integration
  Scenario: A rejected key shows the named error on the field
    Given I selected OpenAI and typed a key the provider refuses
    When I click Connect
    Then the field shows the refusal in the words the error registry chose
    And nothing is saved

  @integration
  Scenario: A refused key stays in the field for the user to fix
    Given I selected OpenAI and typed a key the provider refuses
    When the provider list refreshes after the check
    Then the key I typed is still in the field

  @integration
  Scenario: A key already set on the server is used unless the user pastes their own
    Given the server carries a key for OpenAI in its environment
    When I select OpenAI
    Then the panel says the server already has a key for OpenAI
    And Connect uses that key when I paste none

  @integration
  Scenario: A Codex sign-in that times out says so and lets the user try again
    Given I started the Codex sign-in
    When the sign-in is not approved in time
    Then I see "The sign-in timed out before it was approved."
    And I can start the sign-in again

  @integration
  Scenario: A connected provider is saved at the organization and becomes Langy's model
    Given I selected OpenAI, typed a valid key and kept the recommended model
    When I click Connect
    Then the provider is saved for the whole organization
    And the picked model is the Default model and Langy's model for the organization
    And the organization records the provider and the model

  @integration
  Scenario: Connecting a provider lands the user on the first pick
    Given I picked Gateway first
    When the provider connects
    Then I land on the Gateway home

  @integration
  Scenario: Each path lands on its own page
    Then Evals & LLM Ops lands on the project's traces
    And Gateway lands on the gateway home
    And Governance lands on governance
    And Coding Agent Tracking lands on the personal usage page

  # ============================================================================
  # Skip
  # ============================================================================

  @integration
  Scenario: Skip Guided Tour asks the user to confirm
    When I click "Skip Guided Tour"
    Then I see "Are you sure sure?" and "It's much easier to get Langy to setup everything for you."
    And the choices are "Skip anyway" and "Keep the guide"

  @integration
  Scenario: Keep the guide closes the dialog
    Given the skip dialog is open
    When I click "Keep the guide"
    Then the dialog closes and the provider screen stays

  @integration
  Scenario: Skip anyway records the skip and lands the user on the first pick
    Given the skip dialog is open
    When I click "Skip anyway"
    Then the organization records that the provider was skipped
    And I land on the first pick's page

  @integration
  Scenario: Skip anyway skips the tour as well
    When the provider skip is recorded
    Then the organization records the tour as skipped in the same call
    And the provider skipped and tour skipped events both reach the onboarding event hook

  # ============================================================================
  # Self-hosted
  # ============================================================================

  @integration
  Scenario: The takeover offers Codex wherever the panel's model setup does
    # One availability rule for both pickers, the provider registry's own
    # per-surface rule, so a self-hosted install never hides Codex from the
    # takeover while the panel's inline model setup offers it.
    Given the install is self-hosted
    When the provider screen opens
    Then the marks start with Codex, selected
    And every mark is a provider the panel's inline model setup also offers

  # ============================================================================
  # Resume and continuation
  # ============================================================================

  @integration
  Scenario: A reload after the organization exists resumes at the hello screen
    Given my organization was created in the guided variant and has no paths recorded
    When I open the welcome page again
    Then the hello screen opens instead of the organization form

  @integration
  Scenario: A reload after the picks resumes at the provider screen
    Given my organization has the paths recorded and no provider yet
    When I open the welcome page again
    Then the provider screen opens

  @integration
  Scenario: A reload after the provider step leaves the welcome page
    Given my organization has a provider recorded or the provider step skipped
    When I open the welcome page again
    Then I am sent into the product

  @integration
  Scenario: A classic organization is never shown the takeover
    Given my organization was created in the classic variant
    When I open the welcome page again
    Then I am sent into the product

  @integration
  Scenario: A pending continuation wins over the landing
    Given I arrived with a return_to continuation
    When the provider step finishes
    Then I am sent to the continuation instead of the first pick's page

  # ============================================================================
  # Analytics
  # ============================================================================

  @integration
  Scenario: The takeover reports its steps without ever carrying a key
    When I go through hello, value and provider
    Then the viewed, selected, clicked, connected and skip events carry the screen, the paths and the provider
    And no event carries the API key

  # ============================================================================
  # End to end, in a real browser (platform/app/e2e/guided-onboarding.e2e.test.ts)
  # ============================================================================

  @e2e
  Scenario: A fresh sign-up goes through the guided screens and lands with the panel open
    Given the guided variant is on for my browser
    When I sign up with a new account
    Then I create my organization and answer the tailor step
    And Langy greets me letter by letter and I press Next
    And I pick Evals & LLM Ops first and Gateway second, numbered in that order
    And I connect OpenAI with a working key and see Connected
    And I land on my project's traces page with the Langy panel already open

  @e2e
  Scenario: Skipping the guided tour on the provider screen lands on the personal home with the panel asking for a model
    Given the guided variant is on for my browser
    And I signed up, created my organization and picked Coding Agent Tracking
    When I choose "Skip Guided Tour" on the provider screen
    Then I am asked "Are you sure sure?"
    When I confirm with "Skip anyway"
    Then I land on my personal home with the Langy panel open
    And the panel asks for the model the provider step would have connected
    And no offer is shown there, because the coding path is the one being guided
    And the skip is recorded on my organization

  @e2e
  Scenario: With the flag off the classic wizard is unchanged
    Given the guided variant is off for my browser
    When I sign up with a new account and create my organization
    Then the classic "What do you want to do?" step follows
    And no Langy takeover screen is shown
