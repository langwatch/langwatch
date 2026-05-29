Feature: Trigger action classification — notify vs persist

  A trigger's action falls into one of two classes, and the class decides
  when dispatch happens:

    - Notify actions land in front of a human (email, Slack). Many
      invocations in a short window is a notification storm, so notify
      actions may be batched into a digest window.
    - Persist actions write durable data the customer asked for (dataset
      rows, annotation-queue items). Many invocations is the intent, so
      persist actions always dispatch immediately.

  This classification is the contract the outbox dispatch layer reads to
  decide when a matched trigger fires.

  See dev/docs/adr/025-notify-persistent-action-classification.md.

  Scenario: Email and Slack are notify actions
    Given a trigger whose action sends an email or a Slack message
    Then the action is classified as a notify action

  Scenario: Dataset and annotation-queue writes are persist actions
    Given a trigger whose action writes to a dataset or an annotation queue
    Then the action is classified as a persist action

  Scenario: Every trigger action belongs to exactly one class
    When the notify and persist classes are combined
    Then together they cover every trigger action
    And no action appears in both classes

  # Cadence only changes when notify actions fire; persist is always now.

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
