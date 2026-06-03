Feature: Per-trigger dispatch timing — cadence and trace-readiness debounce

  Each trigger configures two independently-tunable knobs that gate when a
  dispatch fires:

    - The action's class decides whether cadence applies at all. Notify
      actions (email, Slack) land in front of a human — many invocations in a
      short window is a notification storm, so notify actions may be batched
      into a digest window. Persist actions (dataset, annotation-queue writes)
      always dispatch immediately because every match is the intent.
    - The trace-readiness debounce decides how long the dispatch pipeline waits
      after the last span before re-evaluating filters. This stops half-formed
      dispatches that fire on partial trace state and then walk themselves back
      on the trace's final span.

  Both knobs live on the Trigger row. Cadence applies only to notify actions;
  debounce applies to all action classes (a half-formed dataset row corrupts
  the customer's eval set just as surely as a half-formed notification).

  See dev/docs/adr/026-per-trigger-dispatch-timing.md.

  Background:
    Given a project with automations enabled

  Rule: Every trigger action belongs to exactly one class

    Scenario: Email and Slack are notify actions
      Given a trigger whose action sends an email or a Slack message
      Then the action is classified as a notify action

    Scenario: Dataset and annotation-queue writes are persist actions
      Given a trigger whose action writes to a dataset or an annotation queue
      Then the action is classified as a persist action

    Scenario: The two classes together cover every action
      When the notify and persist classes are combined
      Then together they cover every trigger action
      And no action appears in both classes

  Rule: Cadence schedules notify dispatches; persist always fires immediately

    Scenario: Persist actions dispatch immediately regardless of cadence
      Given a trigger with a persist action
      And the trigger is configured with any notification cadence
      When the dispatch time is computed
      Then dispatch is scheduled immediately

    Scenario: Notify actions on the immediate cadence dispatch immediately
      Given a trigger with a notify action
      And the trigger is configured for immediate notification
      When the dispatch time is computed
      Then dispatch is scheduled immediately

    Scenario: Notify actions on a digest cadence wait for the window to close
      Given a trigger with a notify action
      And the trigger is configured for a digest cadence
      When the dispatch time is computed
      Then dispatch is scheduled at the end of the digest window
      And the window length matches the configured cadence

    Scenario: Cadence is a per-trigger setting
      Given two destinations that need different notification cadences
      Then each destination is configured as its own trigger
      And one trigger carries exactly one cadence

  Rule: Cadence defaults preserve existing behavior

    Scenario: Existing triggers keep firing immediately after the upgrade
      Given an automation that existed before the cadence feature shipped
      When a matching trace arrives
      Then the notification is sent immediately
      And the trigger's cadence is shown as "Immediate" in settings

    Scenario: New notification automations default to a 5-minute digest
      When the user creates a new email or Slack automation
      Then its cadence is "Every 5 minutes" by default

    Scenario: Persist automations do not expose a cadence
      When the user creates an automation that adds matches to a dataset
      Then the cadence dropdown is not shown
      And every matching trace is written to the dataset as it arrives

  Rule: Multiple matches inside a window coalesce into one digest

    Scenario Outline: A single match in the window sends one notification
      Given an automation with cadence "<cadence>"
      When one matching trace arrives within the window
      Then one notification is sent at the end of the window
      And the notification body references one trace

      Examples:
        | cadence              |
        | Every 5 minutes      |
        | Every 15 minutes     |
        | Every hour           |

    Scenario Outline: Multiple matches in the window are coalesced into one digest
      Given an automation with cadence "<cadence>"
      When <count> matching traces arrive within the window
      Then exactly one notification is sent at the end of the window
      And the notification body references all <count> traces

      Examples:
        | cadence              | count |
        | Every 5 minutes      | 3     |
        | Every 15 minutes     | 12    |
        | Every hour           | 50    |

    Scenario: Matches arriving after the window open a new digest
      Given an automation with cadence "Every 5 minutes"
      And two matching traces arrive that get coalesced into one digest
      When a third matching trace arrives after the digest has been sent
      Then a new digest window opens for the third trace
      And the third trace is delivered in its own notification at the end of that window

    Scenario: Changing the cadence applies to future matches only
      Given an automation with cadence "Every hour"
      And matching traces are already queued inside the hour window
      When the user changes the cadence to "Immediate"
      Then in-flight matches still dispatch at the end of the original window
      And matches arriving after the change dispatch immediately

    Scenario: The same trace does not appear in two digests
      Given an automation with cadence "Every 5 minutes"
      When the same trace matches the filter twice within the window
      Then it appears once in the next digest
      And the per-(trigger, trace) dedup rule is preserved

    Scenario: Cadence does not affect dataset writes on a mixed-action workflow
      Given a dataset automation and an email automation share the same filter
      When 10 matching traces arrive within 5 minutes
      Then all 10 rows are written to the dataset immediately
      And the email automation sends one digest at the end of the 5-minute window

  Rule: Trace-readiness debounce waits for the trace to settle before evaluating

    Scenario: Default debounce of 30s applies to every new trigger
      When the user creates any automation
      Then the trigger's traceDebounceMs defaults to 30000

    Scenario: Existing triggers also default to 30s after migration
      Given an automation that existed before the debounce feature shipped
      Then its traceDebounceMs is 30000
      And the operator can flip it to 0 to restore eager evaluation

    Scenario: The debounce window resets on every new span
      Given a trigger with a 30-second debounce
      When spans for a matching trace arrive every 5 seconds
      Then no filter evaluation runs while the spans keep arriving

    Scenario: Filter evaluation runs after the trace settles
      Given a trigger with a 30-second debounce
      When the trace receives no further spans for 30 seconds
      Then the dispatch pipeline re-reads the now-settled fold once
      And runs filters against the final state

    Scenario: Two triggers on the same trace settle independently
      Given two triggers on the same trace, each with a different debounce window
      When spans for the trace arrive
      Then each (trigger, trace) pair tracks its own debounce TTL
      And the longer-debounced trigger waits longer before evaluating

    Scenario: Debounce applies to persist actions too
      Given an add-to-dataset trigger with a non-zero debounce
      When spans for a matching trace arrive
      Then the dataset row is captured only after the trace settles
      And the captured row reflects the trace's final state

    Scenario: Setting debounce to 0 restores eager evaluation
      Given a trigger configured with traceDebounceMs of 0
      When a span for a matching trace arrives
      Then the dispatch pipeline evaluates filters on that span immediately

  Rule: Debounce and cadence compose

    Scenario: Combined debounce + digest waits for both windows
      Given a trigger with a 60-second debounce and a 5-minute digest cadence
      When a matching trace settles after 60 seconds
      Then the matched dispatch is held for the next 5-minute digest boundary
      And the customer sees the notification at most ~6 minutes after the trace started
