Feature: Langy's gateway virtual key
  Langy calls models through the AI gateway on a virtual key of its own,
  one per project, which customers never see in their key listings.

  @unit
  Scenario: Langy mints its project's gateway key on first need and keeps it
    Given a project with no Langy key stored
    When Langy needs its credentials for that project
    Then the gateway mints a key named "Langy", owned by no user and scoped to only that project
    And the key is marked as managed by Langy
    And its secret is stored under the project's reserved Langy secret name

  @unit
  Scenario: A project's stored Langy key is reused, never minted again
    Given a project that already stores its Langy key
    When Langy needs its credentials for that project
    Then the stored key is used
    And the gateway mints nothing

  @unit
  Scenario: Two first chats racing on one project agree on one key
    Given two first chats start on one project at once
    When both mint a key and store it
    Then both use the key that was stored first

  @unit
  Scenario: A conversation's credentials resolve once the project's Langy key is provisioned
    Given the process composes Langy with the gateway and project secrets
    When a conversation asks for the project's Langy key
    Then it receives the provisioned key instead of a "Langy is not enabled" refusal
