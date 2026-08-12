Feature: The in-depth view of an automation

  The View drawer answers two questions about one automation: what has it
  done, and what will it do next. The full firing history sits on one
  timeline, the last evaluation of an alert sits on that same timeline
  (observed value against threshold, or the reason the check was skipped),
  and the drawer states when the automation fires next.

  Before this, an alert that never fired said nothing at all: the evaluator
  computed an observed value on every check and recorded nothing readable,
  so "why is this not firing?" had no answer anywhere in the product
  (#6716 G3).

  Background:
    Given a user viewing an automation in the View drawer

  Rule: The timeline shows the last evaluation of an alert

    @integration
    Scenario: The view shows the last evaluation with observed value vs threshold
      Given an alert that was evaluated and did not cross its threshold
      When the user opens the View drawer for it
      Then the timeline shows when it was last checked
      And it shows the observed value alongside the threshold
      And it says the alert did not fire

    @integration
    Scenario: An alert that crossed its threshold reads as fired
      Given an alert whose last evaluation crossed its threshold
      When the user opens the View drawer for it
      Then the timeline says the alert fired on that evaluation

    @integration
    Scenario: A skipped evaluation names its reason
      Given an alert whose last check was skipped because the graph groups by too many values
      When the user opens the View drawer for it
      Then the timeline says the check was skipped
      And it names the reason in words the reader can act on

    @integration
    Scenario: An alert that has never been evaluated says so
      Given an alert that has never been evaluated
      When the user opens the View drawer for it
      Then the timeline says it has not been checked yet

  Rule: An evaluation is recorded on every check

    @unit
    Scenario: An evaluation that did not breach records its observed value
      Given a graph alert whose metric is below its threshold
      When the evaluator checks it
      Then the latest evaluation records the observed value, the threshold, and that it did not fire

    @unit
    Scenario: A skipped check records why it was skipped
      Given a graph alert whose timeseries read exceeds the row ceiling
      When the evaluator checks it
      Then the latest evaluation records that the check was skipped for an oversized result

    @unit
    Scenario: A misconfigured alert records the configuration that is missing
      Given a graph alert with no series selected
      When the evaluator checks it
      Then the latest evaluation records that the check was skipped for incomplete configuration

    @unit
    Scenario: A failure to record an evaluation never fails the alert
      Given recording the latest evaluation fails
      When the evaluator checks an alert that crossed its threshold
      Then the alert still fires

  Rule: The view says when the automation fires next

    @integration
    Scenario: The view shows the next scheduled firing
      Given a report with an active calendar entry
      When the user opens the View drawer for it
      Then the view shows the next time it sends

    @integration
    Scenario: A paused report does not claim a next firing
      Given a report that is paused
      When the user opens the View drawer for it
      Then the view says it sends nothing while it is paused

    @integration
    Scenario: A digest automation shows when its next window closes
      Given an automation that batches its notifications every 5 minutes
      When the user opens the View drawer for it
      Then the view says when the next batch is sent

    @integration
    Scenario: An alert says how often it is checked
      Given an alert with no calendar entry of its own
      When the user opens the View drawer for it
      Then the view says the alert is checked as data arrives

  Rule: The conditions can be run on demand against recent traces

    @integration
    Scenario: Run now lists currently matching traces
      Given an automation whose conditions are a trace search query
      When the user runs the conditions against recent traces
      Then the matching traces are listed with an excerpt of their input and output

    @integration
    Scenario: A never-matched automation explains itself
      Given an automation whose conditions match no recent trace
      When the user runs the conditions against recent traces
      Then the view says nothing matched in the last 7 days
      And it says the automation only acts on traces that match

    @integration
    Scenario: An alert offers no trace run because it watches a graph
      Given an alert that watches a graph metric
      When the user opens the View drawer for it
      Then no run-against-traces control is offered
