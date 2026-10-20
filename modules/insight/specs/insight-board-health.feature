Feature: The daily run checks the board's widgets
  Every daily run checks each widget of its board before it asks whether the project took new
  traces, and without a model call. A widget that fails or shows no data gets one card in its
  person's inbox, renewed while it stays broken. A failure the person cannot fix, such as an
  outage or a memory limit of ours, files nothing. The check leaves most of the project's query
  window to people reading boards. Langy is told which widgets were reported and never sees
  their cards. A From LangWatch board is checked as soon as the server can read its widgets;
  until then the run skips it before the check (template_board).
  Decisions: modules/insight/adrs/005-board-health-check.md

  Background:
    Given the release_insights flag is on for the project
    And a member with analytics:view and langy:create, with a schedule on for a board

  Rule: Every run checks the board, before the question of new traces

    @unit
    Scenario: A widget that shows no data files a card on a day without new traces
      Given the project took no trace since the run's window began
      And the board's one widget returns no rows
      When the run is carried out
      Then it is recorded as filed with the reason no_new_traces and 1 filed
      And the person's inbox holds one card titled with the widget's name, tone watch, filed by the run
      And Langy is never called

    @unit
    Scenario: A healthy board on a day without new traces files nothing
      Given the project took no trace since the run's window began
      And every widget returns data
      When the run is carried out
      Then it is recorded as nothing with the reason no_new_traces and nothing is filed

    @unit
    Scenario: The check's cards and Langy's findings add up in one outcome
      Given the project took a trace and one widget returns no rows
      And Langy answers with one finding
      When the run is carried out
      Then it is recorded as filed with 2 filed

    @unit
    Scenario: A run whose Langy turn fails keeps the count of the cards the check filed
      Given the project took a trace and one widget returns no rows
      And Langy's turn fails
      When the run is carried out
      Then it is recorded as failed with 1 filed

  Rule: A statement runs as the board shows it, without a model call

    @unit
    Scenario: A statement runs as the person over the board's default period
      Given a widget whose stored query declares a parameter with a default
      When the run is carried out
      Then the statement runs with the person's own caller and protections
      And over the 30 days that end where the run's window ends, at a one-day step, coarsened when too fine
      And with the parameter's default, leaving out Langy's traces as the board does, as a background caller
      And in a personal project it leaves out no origin

    @unit
    Scenario: A statement that calls an eval function is never run
      Given a widget whose stored query calls an eval function
      When the run is carried out
      Then the statement is validated with the eval gate open and never run
      And no card is filed and the widget is counted unchecked

    @unit
    Scenario: A statement with a parameter that has no default is never run
      Given a widget whose stored query declares a parameter without a default
      When the run is carried out
      Then the statement is never validated or run and the widget is counted unchecked

    @unit
    Scenario: A widget with no stored query is not checked
      Given a widget that stores no query
      When the run is carried out
      Then nothing runs for it and no card is filed

  Rule: An error or no data is broken; a failure of ours is not

    @unit
    Scenario: A refusal the person can fix files an error card
      Given a widget whose stored query is refused with lwql_unknown_identifier
      When the run is carried out
      Then one card is filed with the key "board-health:<widget id>:error" and the tone bad
      And its body names the code and holds no web address

    # The board shows "No traces in this period" for the same shape: a count over nothing.
    @unit
    Scenario: A widget whose every statement comes back empty shows no data
      Given statements that each return one of: no rows or rows whose every value is null beside a report of a missing field, one row whose every value is 0 or null beside a report of no traffic, or a report of no traffic in the period
      When the widget's health is read
      Then it shows no data

    # A rollup view, such as trace_metrics_by_minute, carries no report; a report can also fail.
    @unit
    Scenario: A zero with no report of no traffic is not checked
      Given a statement that returns one row whose every value is 0
      And the analytics module reports traffic in the period, or makes no report
      When the widget's health is read
      Then it is not checked, and no card is filed for it

    # A filtered widget, such as errors by tier in a month with no errors, is right to be empty.
    @unit
    Scenario: An empty answer over a period with traffic, or with no report, is not checked
      Given a statement that returns no rows, or rows whose every value is null
      And the analytics module reports traffic in the period, complete or partial, or makes no report
      When the widget's health is read
      Then it is not checked, and no card is filed for it

    @unit
    Scenario: An error and an empty statement on one widget file one error card
      Given a widget with one statement refused for the person and one that returns no rows
      When its health is read
      Then it is broken with an error, and only one card is filed for it

    @unit
    Scenario: A failure the person cannot fix files nothing
      Given a statement that fails with any of lwql_unavailable, lwql_provisioning_incomplete, lwql_app_function_unavailable, lwql_app_function_hydration_failed, lwql_busy, clickhouse_unavailable, query_timeout, query_memory_exceeded, query_scan_limit_exceeded, or an error that is no refusal
      When its failure is classified
      Then it is the platform's, and no card is filed for it

    @unit
    Scenario: A platform failure leaves the run to carry on
      Given every widget's statement fails with clickhouse_unavailable
      When the run is carried out
      Then no card is filed, each widget is counted platform, and the run still asks for new traces

    @unit
    Scenario: A failed read or write of the cards leaves the run to carry on
      Given a widget that shows no data, and the insights store fails to read or write its card
      When the run is carried out
      Then the check reports no card instead of failing the run

    @unit
    Scenario: When most statements fail with the same code, the whole check is the platform's
      Given 4 widgets whose statements all fail with lwql_unknown_identifier
      When the run is carried out
      Then no card is filed and each widget is counted platform
      And 2 widgets failing so on a larger board still file their error cards

  Rule: The check runs only where the board can run queries

    @unit
    Scenario: With the Workbench off for the project, no statement runs
      Given the project's rollout does not admit it to the Workbench
      When the run is carried out
      Then no statement is validated or run, no card is filed, and the check is counted off once

  Rule: The check leaves the project's query window to people

    @unit
    Scenario: Every statement runs as a background caller
      When the run is carried out
      Then each statement asks for a background caller's share of the project's query window
      And the analytics module refuses it once that window holds a third of its bound, whoever used it

    @unit
    Scenario: A full query window pauses the check until it opens again
      Given the project's query window refuses the check, to be retried after 20 seconds
      When the check runs
      Then it waits 20 seconds and runs the same statement again
      And no statement starts after the check's 3 minutes, and the widgets left are counted unchecked and file nothing

    @unit
    Scenario: A full query window whose wait outlasts the budget ends the check
      Given the project's query window refuses the check, to be retried after longer than the check has left
      When the run is carried out
      Then no further statement runs, and the widgets left are counted unchecked and file nothing

  Rule: One card per broken widget, renewed while it stays broken

    @unit
    Scenario: A widget still broken the next day renews its card
      Given a card the check filed yesterday for a widget that is still broken
      When today's run is carried out
      Then that card is renewed, nothing is filed, and the run counts 1 renewed

    @unit
    Scenario: A card marked done stays done while the widget stays broken
      Given the person marked yesterday's card done and the widget is still broken
      When today's run is carried out
      Then the card is renewed and stays done

    @unit
    Scenario: A card nobody renewed for its 3 days is resolved, and the next break files a new one
      Given a card whose 3 days ran out without a renewal
      When a run finds the widget broken again
      Then a new card is filed under a new id

    @unit
    Scenario: A card is found by its key, however many insights are newer
      Given a card the check filed for a widget, and 500 newer insights for the person
      When the next run finds the widget still broken
      Then that card is renewed and no second card is filed

    @unit
    Scenario: A card filed by a run asked for after the scheduled slot is still found
      Given a card filed later in the day than the slot of the next run that reads it
      When that run finds the widget still broken
      Then the card is renewed and no second card is filed

    @unit
    Scenario: A retried run files each card once
      Given a run that filed a card and was then carried out again
      When the second attempt checks the board
      Then it files the card under the same id, once

  Rule: At most 5 cards per board per run

    @unit
    Scenario: More than 5 broken widgets file 4 cards and one that lists the rest
      Given 7 broken widgets on one board
      When the run decides its cards
      Then the first 4 in board order get a card each
      And one more card names the other 3
      And its title holds no count, since a renewal keeps the title, and its body counts 3

  Rule: Langy neither sees the check's cards nor reports the same widgets

    @unit
    Scenario: The brief names the reported widgets and never lists their cards
      Given the check found a widget broken, and the person has its open card
      When Langy is briefed
      Then the brief names that widget as already reported and asks Langy not to report it
      And the brief's open insights do not list the card

    @unit
    Scenario: A Langy finding that names a health card is filed as new
      Given Langy answers with a finding whose renews names a health card's id
      When the run files its findings
      Then that finding is filed as a new insight and the health card is not renewed by it
