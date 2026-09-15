Feature: The browser waits for an API that is still starting

  The browser application and the API are separate processes. In local
  development the browser is served in under a second and the API takes several
  more, so the first session read lands on a port nobody is listening on. Read
  as "the session endpoint refused", that turns a booting stack into a sign-in
  screen plus a failure toast — a scolding for something the reader did not do
  and cannot fix.

  An unanswerable API is not a refusal. A refusal has an author: a 401 means the
  reader is not signed in, a handled error means the platform named the cause.
  A connection that was never made names nothing, so the shell holds the reader
  where they were asking to go, says what it is waiting for, and continues the
  moment the API answers.

  @integration
  Scenario: The API is not listening yet
    Given the session read fails because nothing answered on the API's address
    When the application resolves who is here
    Then the reader is shown the waiting screen naming the endpoint being polled
    And the reader is not sent to the sign-in screen
    And no failure is reported to the reader

  @integration
  Scenario: The API answers and the reader continues
    Given the reader is on the waiting screen
    When the API's health endpoint answers
    Then the session read is run again
    And the screen the reader asked for is rendered
    And no failure is reported to the reader

  @integration
  Scenario: A genuine refusal still goes to sign in
    Given the session endpoint answers that the reader is not authenticated
    When the application resolves who is here
    Then the reader is sent to the sign-in screen
    And the waiting screen is not shown

  @integration
  Scenario: A long wait in development names the command that starts the API
    Given the reader has been on the waiting screen for a minute
    And the application is running in development
    Then the waiting screen names the command that starts the API

  @integration
  Scenario: A long wait in production names no command
    Given the reader has been on the waiting screen for a minute
    And the application is not running in development
    Then the waiting screen names no command
    And the waiting screen keeps polling
