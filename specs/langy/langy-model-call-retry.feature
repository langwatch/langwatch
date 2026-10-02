Feature: Langy retries a transient model or tool failure inside the turn
  As someone mid-conversation with Langy when the model provider is overloaded
  or the network drops for a moment,
  I want Langy to try again on its own, the way a coding agent does,
  so that I only see an error and "Try again" when it really cannot go on.

  # The retry runs inside the worker, one model call at a time. When a model
  # call fails for a transient reason, the failed assistant message is dropped
  # and the same call is made again against the conversation as it stands:
  # every tool call that already ran keeps its result, so nothing the turn did
  # runs twice. This is different from the panel's turn recovery
  # (langy-turn-recovery.feature), which re-drives a whole turn and stands down
  # once a tool changed something.
  #
  # The relay still re-sends a rejected 429 by the provider's Retry-After
  # before the worker sees it (langy-turn-recovery.feature). The worker's retry
  # covers what the relay cannot: an error event inside a stream already
  # answered 200, a dropped stream, a network failure and a 5xx.

  Rule: A transient model failure is retried with a growing wait

    @unit
    Scenario: An overloaded provider is retried until it answers
      Given a model call ends with the provider saying it is overloaded
      When the worker reads the failure
      Then it waits and makes the same call again, up to five more times
      And the waits grow as one, two, four, eight and sixteen seconds, each shifted by a small random amount
      And the turn goes on once a call succeeds

    @unit
    Scenario: A wait the provider names is the wait Langy takes
      Given a model call fails with a rate limit that names how long to wait
      When the worker schedules the retry
      Then it waits the time the provider named instead of its own backoff
      But a named wait longer than a minute is not waited out and the failure stands

    @unit
    Scenario: Network failures, timeouts, dropped streams and server errors are transient
      Given a model call fails with a network error, a timeout, a stream that ended early, a 5xx or a 429
      When the worker classifies the failure
      Then it is retried

    @unit
    Scenario: A refusal is not retried
      Given a model call fails with a 4xx refusal, a validation error, a permission error or a plan limit
      When the worker classifies the failure
      Then it is not retried and the turn fails with that error

    @unit
    Scenario: The error shows only after the last attempt
      Given every attempt of a model call fails with a transient error
      When the fifth retry fails too
      Then the turn fails with the last error and the panel offers "Try again"

  Rule: A retry never repeats what the turn already did

    @integration
    Scenario: Tool calls that ran before the failure do not run again
      Given a turn in which the model called a tool and the tool ran
      And the next model call failed with a transient error
      When the worker retries that call
      Then the tool is not called a second time
      And the retried call sees the tool's result

    @unit
    Scenario: Stopping the turn during a wait ends the retries
      Given the worker is waiting before a retry
      When the person stops the turn
      Then the wait ends at once and no further call is made

  Rule: The person sees a quiet retry line, not an error

    @unit
    Scenario: The panel shows which attempt is running
      Given a model call failed with a transient error
      When the worker schedules the second retry
      Then the panel's status line reads "Retrying (2 of 5)"
      And no error card is shown

    @unit
    Scenario: The retry line clears once the call succeeds
      Given the panel shows a retry line
      When the retried call succeeds
      Then the retry line is cleared

    @unit
    Scenario: The retry line shows on a turn that picks up after an answered card
      Given the turn already shows output, such as a card the person answered
      And the manager's "Thinking…" line arrived before the worker's first frame
      When the first model call fails and the worker schedules a retry
      Then the retry line is a status of its own, not the "Thinking…" placeholder the panel hides

    @unit
    Scenario: An in-stream error that is not a plan limit is left to the worker's retries
      Given a relayed call's 200 stream ends with an error event that names no plan limit
      When the same conversation's calls keep failing that way
      Then the relay never turns the next call into a failure of its own
      And the worker's retry budget decides when the turn fails

  Rule: A tool's call to the app is retried only when repeating it is safe

    @unit
    Scenario: Reading a local call's state is retried on a transient failure
      Given the worker polls the app for a local call's result
      When the app does not answer, answers 5xx or answers 429
      Then the worker asks again with a growing wait, up to five more times

    @unit
    Scenario: Starting a local call is retried only when the app says it did not take it
      Given the worker asks the app to start a local call
      When the app answers 429 or 503
      Then the worker asks again
      But when the request may have reached the app, a network error or another 5xx, it is not sent again
