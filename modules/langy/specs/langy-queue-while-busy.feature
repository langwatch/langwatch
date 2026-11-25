Feature: Messages sent while Langy is working wait their turn

  Langy runs one turn at a time per conversation, and the server refuses a second turn while one
  is running. So a message the person sends while Langy works is held in the panel as a queued
  message at the end of the thread, where they can still edit or remove it. When the turn ends,
  Langy picks up every queued message of that conversation, in order, as one follow-up turn.
  Stop lives on the working line above the composer, so the composer's button is always Send.

  @integration
  Scenario: The composer keeps Send while Langy is working
    Given Langy is working on a turn
    Then the composer's button is Send, not Stop
    And Stop sits on the working line above the composer

  @integration
  Scenario: A message sent while Langy works waits in the thread as queued
    Given Langy is working on a turn
    When I type a message and press Send
    Then the message shows at the end of the thread marked as queued
    And the composer is empty again
    And no second turn is started

  @unit
  Scenario: Queued messages go as one follow-up turn when the turn ends
    Given two messages are queued while Langy works
    When the turn ends
    Then Langy gets one message with both texts, in the order they were sent
    And nothing is left in the queue

  @integration
  Scenario: A queued message can be edited before it is sent
    Given a message is queued while Langy works
    When I press Edit on it
    Then its text and images go back into the composer
    And it leaves the queue

  @integration
  Scenario: A queued message can be removed
    Given a message is queued while Langy works
    When I press Remove on it
    Then it leaves the thread
    And it is never sent

  @unit
  Scenario: Images attached to a queued message go with it
    Given I attached an image and sent the message while Langy works
    When the queued message is sent
    Then the message carries the image as a file part

  @unit
  Scenario: A turn that fails keeps the queued messages
    Given a message is queued while Langy works
    When the running turn fails
    Then the message stays queued and is not sent on its own
    And Send now sends it as the next turn

  @unit
  Scenario: Stopping keeps the queued messages
    Given a message is queued while Langy works
    When I press Stop
    Then the message stays queued and is not sent on its own
    And Send now sends it as the next turn

  @unit
  Scenario: Queued messages outlive closing and reopening the panel
    Given a message is queued while Langy works
    When I close the panel and open it again
    Then the message is still queued

  @unit
  Scenario: A queued message waits for its own conversation
    Given a message is queued in one conversation
    When I open another conversation
    Then the message is not shown or sent there
    And it is sent when its own conversation is open and idle

  @unit
  Scenario: A follow-up whose send fails gives the words back
    Given queued messages are being sent as the follow-up turn
    When that send fails before a turn starts
    Then their text and images are back in the composer
    But if I typed something new since, they wait in the queue for Send now instead

  @unit
  Scenario: A message sent while a stop settles waits for Send now
    Given I pressed Stop with nothing queued
    When I send a message before the turn has stopped
    Then the message stays queued and is not sent on its own

  @unit
  Scenario: What I am typing stays when the queued messages go
    Given a message is queued while Langy works
    And I am typing a new message
    When the turn ends and the queued message is sent
    Then what I was typing is still in the composer

  @unit
  Scenario: A new chat's queued messages never go to a conversation I pick
    Given a message is queued during the first turn of a new chat
    When I open an existing conversation before that turn names the new chat
    Then the message is not sent to the conversation I opened
    And it waits with the new chat for Send now

  @unit
  Scenario: Queued messages wait while no project is open
    Given a message is queued while Langy works
    When the turn ends while no project is open
    Then the message stays queued
