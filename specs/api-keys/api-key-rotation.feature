Feature: Reopen an API key and rotate its secret
  As a member who holds an API key
  I want to open the key again to read its settings, and rotate it for a new secret
  So that I can replace a leaked or lost secret without filling the create form again

  # Decision: rotation keeps the key's id, settings, grants and usage history and swaps only
  # its secret (a new lookup id and hash). There is no grace period: the old secret stops at once.

  Background:
    Given an organization "acme" with a project "alpha"
    And "ada" is an organization admin of "acme"
    And "max" holds the Member role on project "alpha" and owns a personal key "ci"

  Rule: a key opens again to show its settings, never its secret

    @integration
    Scenario: Clicking a key opens its details
      When "max" clicks the key "ci" in the API keys list
      Then a details view opens with its name, owner, scopes and permissions
      And it shows the key's expiry, creation date and last use
      And the details show the masked prefix of the secret and never the secret itself

    @integration
    Scenario: The details view offers Edit, Rotate and Revoke to whoever may change the key
      When "max" opens the details of the key "ci"
      Then the details offer "Edit", "Rotate" and "Revoke"

  Rule: rotating swaps the secret, keeps the key, and shows the new secret once

    @unit
    Scenario: Rotating answers a new secret once and keeps the key's id
      When "max" rotates the key "ci"
      Then the answer carries a new token starting with "sk-lw-"
      And the key keeps its id, name, permissions and grants

    @unit
    Scenario: The old secret is refused at once and the new one is accepted
      Given "max" kept the token of the key "ci"
      When "max" rotates the key "ci"
      Then the old token no longer resolves
      And the new token resolves to the same key

    @unit
    Scenario: Only the key's owner or an organization admin may rotate it
      Given "vic" is a member of "acme" who does not own the key "ci"
      When "vic" rotates the key "ci"
      Then the rotation is refused as not owned
      And the key's secret is unchanged
      And when "ada" rotates the key "ci" the rotation succeeds

    @unit
    Scenario: A revoked, expired, system or foreign key cannot be rotated
      When a member rotates a key that is revoked, expired, platform-minted or in another organization
      Then the rotation is refused and nothing is changed

    @unit
    Scenario: An operator acting as a member cannot rotate a key
      When an operator impersonating "max" rotates the key "ci"
      Then the rotation is refused, as minting a key is

    @unit
    Scenario: Rotating is audited without the secret
      When "max" rotates the key "ci"
      Then the audit trail records "apiKey.rotate" with the key's id
      And no audit row contains the new token

    @integration
    Scenario: Rotate asks for confirmation before the old secret stops working
      When "max" chooses "Rotate" on the key "ci"
      Then a confirmation says the current secret stops working immediately
      And nothing is rotated until "max" confirms

    @integration
    Scenario: The new secret is shown once with a copy button
      When "max" confirms the rotation of the key "ci"
      Then a dialog shows the new secret once with a copy button and the setup snippets
      And closing it leaves the key listed under the same name
