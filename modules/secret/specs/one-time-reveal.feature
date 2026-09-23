Feature: A secret can be handed over once, under an id, and never again
  As someone whose tool minted a credential for me
  I want the value shown to me once, where I can copy it
  So that the secret is never stored in a conversation, an event or a history

  # A minted credential exists in plaintext at exactly one moment. A value
  # pasted into a chat, a brief or a tool result is then in the conversation
  # store, the projection, the history list and every viewer's screen, for
  # ever. So the mint parks the secret under a reveal id, sealed, and hands
  # out the ID. The id can travel anywhere; reading it is what serves the
  # value, and the read forgets it.

  Rule: A one-time reveal serves its secret exactly once

    @unit
    Scenario: The first read returns the secret and the second refuses
      Given a secret stashed under a reveal id
      When the reveal id is read
      Then the secret comes back
      And the stored reveal never held the plaintext
      When the same reveal id is read again
      Then the read is refused with the code secret_already_revealed

    @unit
    Scenario: A reveal id that never existed or has expired is refused
      When a reveal id that was never stashed is read
      Then the read is refused with the code secret_reveal_expired

    @unit
    Scenario: A reveal belongs to the organization that stashed it
      Given a secret stashed for one organization
      When another organization reads the reveal id
      Then the read is refused with the code secret_reveal_expired
      And the secret is still there for the organization that stashed it

    @unit
    Scenario: A reveal left unread past its window is gone
      Given a secret stashed under a reveal id
      When a day passes before anybody reads it
      Then the read is refused with the code secret_reveal_expired
