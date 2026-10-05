Feature: The demo hotel bot fills a project with traces

  The hotel bot runs a scripted hotel concierge on the platform's own OpenAI
  key and posts each conversation to the collector with the caller's project
  key, so the project shows real traces. About half the calls are turned away
  on purpose, so the project shows failures too.

  It is for LangWatch staff only. Until the platform-operator door is in place,
  `POST /api/demo/hotel_bot` is not served to any caller; the bot and its door
  are kept so that door can mount them again.

  @unit
  Scenario: The hotel bot is served to no caller until platform operators are admitted
    When the sample agents module is installed
    Then it mounts no route for the hotel bot
    And no caller can reach the bot or its OpenAI channel

  @unit
  Scenario: A call without a project key is refused before any model call
    When the hotel bot is called without an X-Auth-Token
    Then the call is refused as missing credentials
    And no model call is made

  @unit
  Scenario: The bot turns away an even first roll without calling the model
    Given the first roll is even
    When the hotel bot is called with a project key
    Then the call is refused as declined by the demo bot
    And no model call is made

  @unit
  Scenario: The concierge chat posts two turns to the caller's project
    Given the first roll is odd and the second roll is odd
    When the hotel bot is called with a project key
    Then four completions are asked for on the demo model
    And two traces are posted to the collector with the caller's key
    And the answer says the traces were sent

  @unit
  Scenario: The restaurant search posts one trace with its retrieved reviews
    Given the first roll is odd and the second roll is even
    When the hotel bot is called with a project key
    Then one answer and between two and six reviews are asked for
    And one trace with a restaurant retrieval span is posted
    And the answer carries the restaurant reply

  @unit
  Scenario: An unreachable collector still answers that the traces were sent
    Given the collector cannot be reached
    When the hotel bot is called with a project key
    Then the answer says the traces were sent
    And the lost trace is logged as a warning

  @unit
  Scenario: A failing model call fails the run as an unknown error
    Given OpenAI refuses the completion
    When the hotel bot is called with a project key
    Then the run fails with an error that is not handled
    And no trace is posted

  @unit
  Scenario: The OpenAI channel sends the platform key and the conversation
    When the OpenAI channel completes a conversation
    Then it posts the model and messages to the chat completions endpoint with the key as a bearer token
    And it reads back the reply, its creation time and its token counts

  @unit
  Scenario: The OpenAI channel sends nothing without a platform key
    Given the deployment has no OpenAI key
    When the OpenAI channel completes a conversation
    Then it fails without sending a request

  @unit
  Scenario: The OpenAI channel fails on a refused completion
    Given OpenAI answers a completion with an error status
    When the OpenAI channel completes a conversation
    Then it fails

  @unit
  Scenario: The collector channel posts to this deployment's collector with the caller's key
    When the collector channel posts a trace
    Then it posts the trace to the deployment's own collector with the caller's X-Auth-Token

  @unit
  Scenario: The collector channel fails on a refused post
    Given the collector answers with an error status
    When the collector channel posts a trace
    Then it fails

  @unit
  Scenario: The unmounted door hands the caller's key to the hotel bot
    When the hotel bot door is called with an X-Auth-Token
    Then the hotel bot runs with that key
    And the door answers the bot's reply

  @unit
  Scenario: The unmounted door answers a declined run with its code
    Given the hotel bot declines the run
    When the hotel bot door is called with an X-Auth-Token
    Then the door answers 401 with the code demo_bot_declined
