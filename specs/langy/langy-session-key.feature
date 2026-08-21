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
  # Reach — the actions Langy is allowed to ask for on my behalf
  # ---------------------------------------------------------------------------

  Scenario: Langy can list the experiments in my project
    Given I can see my project's experiments
    When I ask Langy about my experiments
    Then Langy lists them
    And Langy is not refused for a permission I already hold

  Scenario: Langy is never refused something it is meant to be able to do for me
    Given a task Langy is trusted to do on my behalf, on data I can already reach
    When I ask Langy to do it
    Then Langy is not turned away for lacking permission

  # The line, as the owner drew it (2026-08-21): Langy does everything on the
  # project's data — create, update, delete, manage — and never WRITES the auth
  # scope (members and roles, credentials, the org's billing). Auth-scope reads
  # are allowed; secrets have no safe read at all. One credential family is
  # carved back IN (owner decision, 2026-08-21): gateway virtual keys — minting
  # them is driving the gateway, and the caller's own grant bounds it. The user's own permissions
  # remain the ceiling for all of it.
  Scenario: Langy can delete my work, because I can
    Given I can delete my own prompts
    When I ask Langy to delete one
    Then the prompt is deleted
    And nothing I did not name is touched

  Scenario: Langy cannot delete my work when I cannot
    Given I cannot delete prompts in this project
    When I ask Langy to delete one
    Then Langy cannot, and says so
    And the prompt is still there

  Scenario: Langy cannot change who can do what, even though I can
    Given I can manage my organization's members and roles
    When I ask Langy to change a member's role
    Then Langy cannot, and says so
    And the member's role is unchanged

  Scenario: Langy cannot read my project's secrets, even though I can
    Given I can read my project's secrets
    When I ask Langy what a secret's value is
    Then Langy cannot, and says so
    And no secret value appears in its answer

  @unit
  Scenario: A permission Langy is never delegated says so
    Given an action the platform never delegates to Langy, whoever asks
    When Langy tries it on my behalf and is refused
    Then the refusal says the permission is not one Langy can be given
    And it does not tell me to widen a key or to ask an admin, which would
      leave me waiting for a grant nobody can make
    And it points me at making the change in LangWatch myself

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
