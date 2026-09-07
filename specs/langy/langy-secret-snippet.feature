Feature: Langy shows a secret once, in a card, never in the conversation
  As a developer setting up the gateway with Langy
  I want the virtual key secret shown to me once, where I can copy it
  So that the secret is never stored in the conversation, the events or the panel history

  # A virtual key secret exists in plaintext at one moment: when the key is
  # minted. Langy used to paste it into a chat code block, and from there it
  # was in the conversation store, the projection, the history list, every
  # viewer's screen and the CLI follow-along, for ever.
  #
  # Now the create stashes the secret under a one-time reveal id, encrypted,
  # for a day. Langy calls its `secret_snippet` tool with that id and a
  # template; the panel renders the card, and the card is what reads the
  # secret, once, straight from the server. The model never sees the value.

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open on a conversation

  Rule: A one-time reveal serves its secret exactly once

    @integration
    Scenario: The first reveal returns the secret and the second refuses
      Given a virtual key secret stashed under a reveal id
      When the reveal id is read
      Then the secret comes back
      And the secret is stored encrypted until it is read
      When the same reveal id is read again
      Then the read is refused with the code secret_already_revealed

    @integration
    Scenario: A reveal id that never existed or has expired is refused
      When a reveal id that was never stashed is read
      Then the read is refused with the code secret_reveal_expired

    @unit
    Scenario: A reveal belongs to the organization that minted it
      Given a virtual key secret stashed for one organization
      When another organization reads the reveal id
      Then the read is refused with the code secret_reveal_expired
      And the secret is still there for the organization that minted it

    @unit
    Scenario: The reveal survives without Redis
      Given an instance running without Redis
      When a secret is stashed and read
      Then the first read returns it and the second is refused, the same as with Redis

  Rule: A create can withhold the secret and hand out a reveal id instead

    @integration
    Scenario: The REST create with reveal_once answers with the reveal id and the prefix, not the secret
      When a virtual key is created over the API with reveal_once set
      Then the response carries the key, its display prefix and a reveal id
      And the response carries no secret
      And reading the reveal id returns the key's secret

    @integration
    Scenario: The tRPC create with revealOnce keeps the secret and adds the reveal id
      When a virtual key is created from the app with revealOnce set
      Then the response carries the secret, for the dialog that shows it once
      And the response carries a reveal id and the display prefix
      And reading the reveal id returns the same secret

    @unit
    Scenario: The CLI create with --reveal-once never prints the secret
      When "langwatch virtual-keys create --name production-app --reveal-once" runs
      Then the output names the key id, the name, the display prefix and the reveal id
      And no output, in any format, carries the secret

  Rule: The secret snippet card shows the secret once and masks it afterwards

    @unit
    Scenario: The worker tool answers the model without the secret
      When Langy calls secret_snippet with a reveal id and a template
      Then the tool answers that the card is shown, and never the key
      And a template without the {{secret}} placeholder is refused with a message saying so
      And a missing reveal id is refused with a message saying so

    @integration
    Scenario: The card reveals the secret on first render, with a copy button
      Given an assistant message carrying a secret_snippet call with a reveal id and a template
      When the card renders for the first time
      Then it reads the secret once from the server
      And it shows the template with the secret filled in and a copy button
      And it says "Shown once. Copy it now, it will not be shown again."

    @integration
    Scenario: The card masks the secret once it has been revealed
      Given a secret_snippet call whose reveal id was already read
      When the card renders again after a reload
      Then it shows the template with the display prefix and a mask where the secret was
      And it says "Shown once at creation, not readable again. Create a new key if you did not save it."

    @integration
    Scenario: A second viewer sees the masked card
      Given a secret_snippet call whose reveal id another viewer already read
      When the card renders for me
      Then it shows the masked template and the not-readable-again line

    @integration
    Scenario: An expired reveal reads as gone
      Given a secret_snippet call whose reveal id has expired
      When the card renders
      Then it shows the masked template
      And it says "Shown once at creation, not readable again. Create a new key if you did not save it."

    @integration
    Scenario: The secret is never in the conversation store
      Given a turn where Langy showed a secret through the secret_snippet card
      When the conversation's stored events and its projection are searched
      Then the full secret appears in none of them
      And the tool call carries only the reveal id, the template and the display prefix

    @unit
    Scenario: The secret snippet call is a card, not an activity row
      When an assistant message carries a secret_snippet call
      Then the activity spine leaves it out
      And the card is the only rendering of the call
