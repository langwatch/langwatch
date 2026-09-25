Feature: The Langy panel's tRPC procedures

  The panel reaches Langy through the `langy.*` and `langyEgress.*` procedures
  main serves. Every one of them runs the same gate before its own work: the
  demo project is refused, and a person the Langy rollout has not reached is
  answered "not enabled", never "forbidden", so the gate cannot be used to
  probe whether Langy exists for the account.

  @unit
  Scenario: A person outside the Langy rollout is answered not enabled
    Given the Langy rollout flag is off for the project's organization
    When they list their conversations
    Then the call refuses with langy_not_enabled
    And no conversation is read

  @unit
  Scenario: The demo project never runs Langy
    Given the project is the shared demo project
    When anyone lists its conversations
    Then the call refuses with langy_not_enabled

  @unit
  Scenario: The conversation list reaches the browser as epoch-millisecond rows
    Given a person inside the rollout with one conversation
    When they list their conversations
    Then the row carries its last activity in epoch milliseconds

  @unit
  Scenario: A conversation that is not visible yet reads as absent
    Given a conversation whose fold has not been projected
    When the panel polls its detail
    Then the answer is empty rather than an error

  @unit
  Scenario: A person over the message budget is refused before a turn dispatches
    Given a person who has spent this minute's message budget
    When they send a message
    Then the call refuses with langy_rate_limited
    And no turn is started

  @unit
  Scenario: A panel-open warm over its budget is a cold start, never an error
    Given a person who has spent this minute's warm budget
    When the panel opens
    Then the warm answers not warmed with the conversation it was asked for

  @unit
  Scenario: A tab cannot claim an action in a conversation it cannot see
    Given a conversation that is not visible to the person
    When their tab claims an action published in it
    Then the claim answers not claimed
    And no action is claimed

  @unit
  Scenario: A tab's completion reaches the action as the signed-in person's
    Given a person whose tab claimed a published action
    When the tab reports the action's outcome
    Then the outcome is handed on under that person's id
    And the answer says whether it was accepted

  @unit
  Scenario: Remembering the code access choice writes it for the signed-in person
    Given a person inside the rollout
    When they choose to have Langy reach their code through GitHub
    Then the choice is written for that person
    And the answer carries the remembered choice
