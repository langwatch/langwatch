Feature: A person getting Langy's first message is recorded for nurturing

  Nurturing tells Customer.io saw_langy_first_message on the person. Langy's conversation events
  carry no person, so langy records the fact itself (§9): when Langy completes an answer in a
  conversation, the conversation's owner got a message from Langy. The fact
  lw.langy_guided_onboarding.first_message_seen is keyed by the person alone, so their first one
  is the one that counts; ids only, never message content.

  @unit
  Scenario: Langy's completed answer records that its owner got Langy's first message
    Given a conversation owned by a person
    When Langy completes an answer in it
    Then first_message_seen is recorded against that person

  @unit
  Scenario: A failed or stopped turn records nothing
    Given a conversation owned by a person
    When Langy's turn fails or the person stops it
    Then nothing is recorded

  @unit
  Scenario: The fact is recorded once per person
    Given a person already got an answer from Langy
    When Langy answers them again, in any conversation
    Then the fact lands on the same key and is not recorded twice

  @unit
  Scenario: An answer in a conversation not folded yet is retried, not dropped
    Given Langy's answer arrives before its conversation is folded
    When the subscriber looks up the conversation's owner
    Then it fails retryably, so the job retries until the conversation is folded
    And nothing is recorded meanwhile
