# Implementation:
#   packages/platform-api-client/src/sse-subscription-link.ts
#   apps/ui/src/behavior/ui-feature-transport.ts
# Plan:
#   dev/docs/plans/ui-subscription-transport.md

Feature: Live updates on the browser process transport

  Several screens do not poll — they watch. A trace list shows spans arriving,
  an experiments workbench shows a run advancing, an export shows its own
  progress, and the Langy panel renders a reply as it is written. Each of
  those is a live procedure, opened once and left open.

  The browser process composition owns the transport those screens run on,
  and until now that transport could send a request and nothing else. A screen
  moved onto it would have kept rendering, kept its first answer, and never
  updated again — no error, no indicator, just a page that had quietly stopped
  being live. This is the lane that carries them.

  The channel is authenticated by nothing more than being the reader's own:
  it is opened against the application's own address, so the browser attaches
  the session it already holds. There is no second credential anywhere in it.

Rule: A live procedure is opened on the live channel, and everything else is unchanged

  Background:
    Given a reader with a signed-in session

  @unit
  Scenario: Watching a procedure opens a live channel
    When a screen watches a live procedure
    Then a live channel is opened for that procedure
    And no request is sent for it

  @unit
  Scenario: Reading a procedure still sends a request
    When a screen reads a procedure
    Then a request is sent for it
    And no live channel is opened

  @unit
  Scenario: Reads asked for their own connection still get one
    When a screen reads a procedure and asks for its own connection
    Then that read travels on its own request
    And other reads in the same moment still share one

  @unit
  Scenario: What the screen is watching for travels with the channel
    When a screen watches a live procedure for one project
    Then the channel names the procedure being watched
    And it carries the project the screen asked about

Rule: The channel carries the reader's own session and no other credential

  @unit
  Scenario: A live channel is opened against the application's own address
    When a screen watches a live procedure
    Then the channel is opened against the same address the screen's reads go to
    And the browser attaches the reader's session to it

  @unit
  Scenario: Nothing mints a credential for the channel
    When a screen watches a live procedure
    Then the channel carries no credential of its own

Rule: A dropped channel comes back, and a channel that cannot come back says so

  @unit
  Scenario: A dropped channel is reopened after a short wait
    Given a screen watching a live procedure
    When the channel drops
    Then it is reopened after a short wait
    And the screen is not told anything went wrong

  @unit
  Scenario: Each further failure waits twice as long
    Given a screen watching a live procedure
    When the channel keeps dropping
    Then each attempt waits twice as long as the one before it

  @unit
  Scenario: A channel that never comes back gives up rather than retrying forever
    Given a screen watching a live procedure
    When the channel drops more times than it is worth retrying
    Then the screen is told the channel failed
    And no further attempt is made

  @unit
  Scenario: A channel that comes back forgets the failures before it
    Given a screen watching a live procedure that dropped and came back
    When the channel drops again
    Then the wait starts over from the shortest one

  @unit
  Scenario: A reopened channel does not read as a new subscription
    Given a screen watching a live procedure that dropped and came back
    Then the screen was told the subscription started exactly once

Rule: What arrives on the channel reaches the screen as what it is

  @unit
  Scenario: An update reaches the screen
    Given a screen watching a live procedure
    When an update arrives on the channel
    Then the screen receives it

  @unit
  Scenario: The channel's own greeting is not an update
    Given a screen watching a live procedure
    When the channel acknowledges the connection
    Then the screen receives no update

  @unit
  Scenario: A finished stream ends the watch
    Given a screen watching a live procedure
    When the stream reports it has finished
    Then the watch ends without an error
    And the channel is closed

  @unit
  Scenario: A failure of the channel itself ends the watch with an error
    Given a screen watching a live procedure
    When the stream reports it could not continue
    Then the screen is told why
    And the channel is closed

  @unit
  Scenario: A failure the watched work reports is an update, not a dead channel
    Given a screen watching a live procedure that can report its own failure
    When the work being watched fails
    Then the screen receives that failure as an update
    And the watch stays open

  @unit
  Scenario: An unreadable frame ends the watch rather than being ignored
    Given a screen watching a live procedure
    When something arrives on the channel that cannot be read
    Then the screen is told the channel failed
    And the channel is closed

Rule: A screen that stops watching leaves nothing open

  @unit
  Scenario: Stopping the watch closes the channel
    Given a screen watching a live procedure
    When the screen stops watching
    Then the channel is closed

  @unit
  Scenario: Stopping the watch cancels a reopen that has not happened yet
    Given a screen watching a live procedure whose channel has dropped
    When the screen stops watching before the channel is reopened
    Then no channel is opened afterwards
