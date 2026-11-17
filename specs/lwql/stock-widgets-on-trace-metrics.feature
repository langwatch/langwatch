Feature: Stock trace widgets read the light trace table
  On a large project the stock widgets that read `traces` run out of memory, and they read it
  only for a few metadata keys. trace_analytics gets one column per key, computed by ClickHouse
  from the row's Attributes; trace_metrics exposes them; and the 15 widget queries that need
  nothing else from `traces` read trace_metrics instead (tasks#1117). The Attributes map stays
  withheld from trace_metrics (tasks#598).

  Background:
    Given traces whose metadata carries output_action, outcome, sent_to_review, document_type, flow, language, segment, team and topic

  Rule: The metadata keys are columns of trace_metrics

    @integration
    Scenario: The migration fills the metadata columns for existing rows
      Given trace_analytics rows written before migration 00126
      When the migration and its background step have run
      Then each row's metadata columns hold the values of its Attributes
      And a missing key reads as empty text

    @unit
    Scenario: trace_metrics exposes the metadata columns under its own access rules
      When the trace_metrics catalogue is read
      Then each metadata key is a String column named Metadata and the key in PascalCase, such as MetadataOutputAction
      And each carries the same gates as TraceName

    @unit
    Scenario: trace_metrics keeps the Attributes map withheld
      When the trace_metrics catalogue is read
      Then it has no Attributes column

    @unit
    Scenario: trace_metrics keeps its latest-version dedup without FINAL
      When the trace_metrics catalogue is read
      Then it still deduplicates on TenantId, OccurredAt and TraceId by the latest UpdatedAt
      And it reads in sort-key order without FINAL, breaking UpdatedAt ties by Version
      And its floored twin bounds OccurredAt, a column of that key

  Rule: The moved widget queries read trace_metrics and return the same rows

    @unit
    Scenario: The moved widget queries read trace_metrics, not traces
      Given the 14 stock queries tasks#1117 lists, plus att-table/passRates, from gen-acceptance/actions to ask-rising/daily
      Then each reads trace_metrics and never traces
      And each keeps to its sources with Source IN {dashboard_context_sources:Array(String)}

    @integration
    Scenario: A moved widget query returns the rows its traces form returned
      Given traces of the application, of Langy and of a simulation
      And a trace that has no trace_metrics row
      When each moved query and its traces form run under the application list and the langy list
      Then both return the same rows

    @integration
    Scenario: A trace with two trace_metrics rows adds its cost once to the summed widgets
      Given an application trace with a second trace_metrics row whose OccurredAt moved
      When the moved queries run under the application list
      Then the queries that sum TotalCost return the same rows as their traces form
      And trace counts stay the same, since they count uniqExact(TraceId)

    @integration
    Scenario: A second trace_metrics row in another bucket or half counts the trace once
      Given an application trace with a second trace_metrics row a bucket later and past the period's midpoint
      When the moved queries run
      Then the queries that bucket or halve the period count the trace once, at its first OccurredAt
      And the queries that sum TotalCost return the same rows as their traces form

    @integration
    Scenario: A second trace_metrics row past the period start keeps the trace before it
      Given a trace from the window before the period with a second trace_metrics row inside the period
      When the queries that split the period run under the application list and the langy list
      Then each counts the trace in the window before only, as its traces form does
      And the other moved queries, which have no first-row filter, still count the trace in the period, unlike their traces form

    @integration
    Scenario: A conversation in two units counts once in each unit's share
      Given a conversation whose traces belong to two customers
      When the share widgets read their per-unit rows and their totals
      Then the totals' conversations equal the sum of the per-unit conversations
      And the shares add up to 100%

    @integration
    Scenario: att-table's pass rates group traces by the units its volumes list
      Given judged application traces, one of them on a unit only trace_metrics carries
      When att-table reads its per-unit volumes and its per-unit pass rates
      Then the units judged in the period are the units its volumes list

  Rule: att-change reads the managed prompt version from trace_metrics

    @unit
    Scenario: att-change reads the managed version from trace_metrics' floored twin, never traces
      Given trace_metrics exposes LastUsedPromptVersionId as a String column, read from trace_analytics
      When att-change's two queries are sent the way the executor sends them
      Then each reads LastUsedPromptVersionId and never names traces
      And every trace_metrics read in them goes to its floored twin
      And no other stock query reads the managed version from traces but the two changes queries

    @integration
    Scenario: A version first used 200 days ago keeps the first-seen time it had
      Given a prompt version first used 200 days ago and used again inside the period
      And the period's newest version before it was first used earlier in the period
      When att-change/change runs as written and through the floored twin, under the application list and the langy list
      Then it returns the rows its traces form returned
      And the version, dated from its first use inside the period and the window before it, is the newest
      And the version it replaced is the one before it

    @integration
    Scenario: A trace whose newest trace_metrics row changed its version reads the newest version
      Given a judged trace written twice inside the window, the newer write with another anchor and another managed version
      And each write reaching both trace_summaries and trace_analytics, the newer with the later UpdatedAt
      When att-change's two queries run, under the application list and the langy list
      Then each returns the rows its traces form returned
      And the trace counts with the newer write's version, at the newer write's time

    @integration
    Scenario: A trace whose newest row anchored before the window counts with its in-window version
      Given a trace whose older write is anchored inside the window and whose newer write is anchored before it
      When att-change/change runs, as written and through the floored twin
      Then it counts the trace with the older write's version, where its traces form leaves the trace out
      And this is the one difference the floored read keeps, since the floor cuts off the newer write
      But att-change/units returns its traces form's rows, as the evaluation moves to the newer anchor too

    @integration
    Scenario: A trace whose two rows carry different sources counts with the listed row's version
      Given a trace written twice inside the window, the older write from application, the newer from langy
      And each write carrying its own managed version
      When att-change/change runs under the application list
      Then it counts the trace with the application write's version, where its traces form leaves the trace out
      And this is part of the trade the floored read makes for its newest-row rule
      When att-change/change runs under the langy list
      Then both forms count the trace with the langy write's version, at the langy write's time

    @integration
    Scenario: att-change and passRates answer within the memory cap on 120 days, whatever the history
      Given a small project and a large project, each with 300 days of older history, and a large project with none
      And every trace judged twice, a tenth of them with an unmerged retraction pair
      When att-change's two queries and att-table's pass rates read a 60-day period and the window before it, under the widget cap at compatibility 25.10
      Then each answers on the large project at or under 70% of the cap
      And its peak on the large project is at most 2.2 times its peak on the small one
      And its peak on the large project is within 10% of the project with no older history

    @integration
    Scenario: A trace folded before the column existed reads its version after the replay
      Given a trace 121 days old, folded before the column existed
      And a trace 123 days old, folded before the column existed
      When the managed prompt version replay has run
      Then the 121-day trace reads its managed prompt version
      And the 123-day trace reads ''

    @unit @integration
    Scenario: A widget reading the managed version says history is rebuilding until the replay is done
      Given a widget whose query reads LastUsedPromptVersionId
      And the ledger holds no managed prompt version replay row, or a pending or running one
      When the widget is shown for any period
      Then the widget shows "Prompt version history is still being rebuilt"
      And its body is never mounted, so its queries never run

    @unit @integration
    Scenario: A period reaching before the replay's start says from when versions are known
      Given a widget whose query reads LastUsedPromptVersionId
      And the managed prompt version replay is done with a recorded since
      When the widget's period, with the period before it, starts before that since
      Then the widget shows "Prompt versions known from" and the since's day
      And its body is never mounted
      But a period whose previous period starts at or after the since shows the body

    @unit @integration
    Scenario: A replay that failed after its retries shows the history as unknown, never the rows
      Given a widget whose query reads LastUsedPromptVersionId
      And the managed prompt version replay's ledger row is failed, or the ledger cannot be read
      When the widget is shown
      Then the floor read answers unknown rather than an error
      And the widget shows "Prompt version history unknown"
      And its body is never mounted

  Rule: The moved widgets render on the app

    # Checked by hand on a local stack with seeded traces; see the PR.
    @e2e @unimplemented
    Scenario: The moved widgets render on a running app
      Given a board holding the moved widgets
      When a member opens it
      Then every moved widget shows its numbers rather than an error
