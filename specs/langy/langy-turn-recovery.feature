Feature: Langy recovers from a failed turn without making the user re-ask
  As someone mid-conversation with Langy when a deploy, a timeout, or a busy
  agent kills the turn,
  I want Langy to quietly pick itself back up,
  so that a transient infrastructure hiccup does not cost me my question.

  # A turn failure arrives on the chat stream as a TYPED domain error
  # (langy_worker_restarting, langy_turn_timeout, langy_agent_unavailable,
  # langy_agent_at_capacity, langy_agent_session_lost, unknown). Because the
  # failures are typed, they can be HANDLED: a recovery policy keyed on the
  # kind decides whether to retry, how long to wait, how many times, and what
  # to say while it happens. Only when the policy gives up does the red error
  # card with its manual "Try again" appear.
  #
  # The retry re-drives the TURN. It never re-posts the user's message: the
  # message was already persisted before the turn ran, so re-sending it would
  # append a second copy of the same question to the conversation.

  @unit
  Scenario: A deploy interrupts the turn and Langy picks it back up
    Given Langy is answering a question
    When the worker restarts mid-answer and the turn fails
    Then the user does not see a red error card
    And Langy shows a quiet line saying it restarted and is picking up where it left off
    And Langy re-drives the turn on its own
    And the user's question appears in the conversation exactly once

  @unit
  Scenario: A busy agent is retried with a countdown, not an error
    Given every Langy worker slot is taken
    When the turn fails because Langy is at capacity
    Then Langy shows a quiet line saying it is busy and counting down to the retry
    And Langy waits longer before each further attempt
    And Langy gives up to an error card once its attempts are exhausted

  @unit
  Scenario: A lost session is terminal and is never retried
    Given Langy lost the session backing this conversation
    When the turn fails
    Then Langy shows the error card immediately
    And Langy does not retry, because a retry would hit the same wall

  @unit
  Scenario: An unrecognised failure is never retried
    Given the turn fails with a kind Langy does not recognise
    When the failure reaches the panel
    Then Langy shows the error card immediately
    And Langy does not retry, because it cannot know what it is retrying into

  # A missing prerequisite is NOT a failure and NOT a dead end. "Do not retry"
  # here means something completely different from "give up": no amount of
  # backing off connects someone's GitHub account, but there is a perfectly good
  # next action and the UI's job is to offer it where the turn stopped. Painting
  # this red would be the product blaming the user for not having finished
  # onboarding.
  #
  # Crucially, Langy works this out by WATCHING WHAT THE AGENT RUNS, not by
  # asking the agent to say so. The old design told the model to print a marker
  # into its reply and then regexed the reply to draw the card — an LLM asked to
  # be a reliable state machine in prose. It could forget, paraphrase, or say it
  # on a turn that never touched GitHub. We can see it run `gh`.
  @unit
  Scenario: Langy reaches for GitHub and the user has not connected it
    Given the user has not connected their GitHub account
    When Langy runs a command that needs GitHub
    Then the turn stops
    And the user does not see a red error card
    And Langy offers a Connect button in the conversation, where the turn stopped
    And Langy does not retry on its own, because only the user can connect it
    And the stalled turn gives back the daily pull-request permit it reserved

  # The false-positive guard, and the reason this is not a blanket pre-flight:
  # most turns never touch GitHub, and stopping them all to demand a connection
  # would break every other request.
  @unit
  Scenario: A turn that never needs GitHub is untouched
    Given the user has not connected their GitHub account
    When Langy answers a question that needs no GitHub access
    Then the turn completes normally
    And the user is never asked to connect anything

  @unit
  Scenario: Local git work does not demand a GitHub account
    Given the user has not connected their GitHub account
    When Langy makes a local commit but never talks to the remote
    Then the turn completes normally
    And the user is never asked to connect anything

  @integration
  Scenario: Connecting GitHub resumes the turn without a duplicate message
    Given a turn stopped because GitHub was not connected
    When the user connects their GitHub account from the card
    Then Langy re-drives the turn without the user retyping anything
    And the conversation holds exactly one copy of the user's message
    And the resumed turn does not consume a second daily pull-request permit
    And the resumed turn runs with the GitHub token in place

  @unit
  Scenario: A turn that already changed something is not silently replayed
    Given Langy already ran a tool that changes the project during this turn
    When the turn then fails with an otherwise-recoverable error
    Then Langy does not retry automatically
    And the user is offered the error card, so the replay is their decision

  @integration
  Scenario: A retry re-drives the turn instead of re-posting the message
    Given a Langy turn failed after the user's message was persisted
    When the turn is retried, automatically or from the error card
    Then the conversation holds exactly one copy of the user's message
    And the retried turn runs against the message already on record
