Feature: Per-session caller-scoped Langy key
  As a member who uses the Langy assistant
  I want each chat session to run against a key scoped to my own permissions
  So that Langy can never do anything I could not do by hand, and a leaked
  session key exposes only my access and only for a short window

  # Replaces the shared, admin-equivalent "Langy" service key at chat time.
  # See "ADR-047: Langy Foundations". The eager project-create provisioning of
  # the dedicated project key is unchanged and covered by
  # langy-api-key-provisioning.feature; this spec governs the CHAT-TIME key.

  Background:
    Given I am signed in
    And I can access Langy in my project

  # ---------------------------------------------------------------------------
  # Minting
  # ---------------------------------------------------------------------------

  Scenario: A Langy chat mints an ephemeral key scoped to the requesting user
    When I start a Langy chat in my project
    Then a fresh Langy session key is minted for me
    And the session key is owned by me
    And the session key expires after a short window

  Scenario: The session key cannot exceed the caller's own permissions
    Given I can view and edit prompts but cannot create triggers
    When I start a Langy chat in my project
    Then the session key can view and edit prompts
    And the session key cannot create triggers
    And this holds even though the old shared key could create triggers

  Scenario: The session key mirrors exactly what I hold, nothing more
    Given I hold only a subset of the actions Langy can use
    When I start a Langy chat in my project
    Then the session key carries exactly the actions I hold
    And it carries none of the actions I lack

  # ---------------------------------------------------------------------------
  # Guardrails
  # ---------------------------------------------------------------------------

  Scenario: A user with no Langy-relevant permissions cannot get a session key
    Given I hold none of the actions Langy can use in this project
    When I start a Langy chat in my project
    Then no session key is minted
    And the chat is refused with an actionable error

  Scenario: The session key acts only within the project it was minted for
    Given I have another project I also belong to
    When a Langy session key is minted for this project
    Then the session key can act only within this project
    And the session key cannot act on my other project
