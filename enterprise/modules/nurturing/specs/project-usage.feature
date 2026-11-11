Feature: Per-email usage reaches Customer.io from nurturing's own project rows

  Nurturing folds the owners' prompt, evaluator, scenario and simulation-run events into its own
  table (peer folds, ARCHITECTURE §9). A peer fold re-folds from one owner's event log, so there
  are four folds, one per owner pipeline, each keeping its own row per project. Evaluations add
  their UTC day to one more row per project, at most once a day. Traces are counted by a peer
  subscriber on trace's span_received, which queues root spans only: a root span is one trace, a
  root span with an error status one failed trace, as trace's own rollup counts them. Root spans
  of one project and day are batched, and each batch adds its counts to that day's row with one
  Postgres upsert; rows are kept 30 days. The increment is not idempotent: a redelivered batch
  may count its traces twice. No span body reaches nurturing, and the rows are not rebuilt by a
  projection replay.
  Nurturing reads no trace data: trace counts start at the count's deploy, and no cost is sent (a
  span carries no price). When a project's usage changes, or its organization traced (throttled
  to once per 15 minutes), nurturing places it in its organization through the owners' shares,
  sums the organization's projects and sends their traits to Customer.io as one group call on
  the admin. It never pulls owner state on a schedule, and sends counts and times only, never
  content. flagged_count waits on its definition.

  @unit
  Scenario: Every owner event becomes the fact its fold counts
    Given an owner event: prompt created, version saved or deleted, evaluator created or deleted, scenario created, simulation set created, or simulation run finished
    When nurturing reads it
    Then it becomes the matching prompt, evaluator, scenario, simulation-set or scenario-run fact at the event's time

  @unit
  Scenario: A fact without a project id is counted on its tenant
    Given a simulation run finished, whose data names no project
    When nurturing reads it
    Then the fact is counted on the event's tenant, which is its project

  @unit
  Scenario: Each owner's fold turns its event into the project's row
    Given each owner's peer fold
    When it folds one of its owner's events
    Then the row is keyed by the event's project and counts what the event says

  @unit
  Scenario: Prompts and evaluators count up when created and down when deleted
    Given a project's fold has taken two prompt.created and one prompt.deleted for another prompt
    And one evaluator.created and its evaluator.deleted
    Then the project counts 2 prompts and 0 evaluators

  @unit
  Scenario: Each simulation set counts once
    Given simulation_set.created arrives twice for one set and once for another
    Then the project counts 2 simulation sets

  @unit
  Scenario: Prompt versions, scenario runs and evaluations mark their UTC day active
    Given a project creates a prompt, saves a prompt version, finishes a scenario run and completes an evaluation
    Then each fact's UTC day is in the project's active days once
    And days older than 30 days before the newest fact are dropped

  @unit @integration
  Scenario: Evaluations mark a project's day once
    Given several evaluations of a project complete on the same UTC day
    Then the project's evaluation row holds that day once
    And later evaluations that day write nothing

  @unit @integration
  Scenario: A trace is its root span, counted on its project's day
    Given root spans of a project's traces appended on one UTC day
    When the trace-day count takes them
    Then each adds one trace to the project's row for that day
    And a root span appended on the next UTC day counts on the next day's row

  @unit
  Scenario: Only a root span mints a trace-day job
    Given a trace's root span and its child spans
    When trace appends them
    Then only the root span is queued to the trace-day count, so a child span costs no job

  @unit
  Scenario: A failed trace is a root span with an error status
    Given a root span with an error status and a root span without one
    When the trace-day count takes them
    Then the day counts 2 traces and 1 failed trace, and the failed one's time

  @unit
  Scenario: Traces arriving out of order count the same
    Given two traces' root spans of one project and day, the older arriving after the newer
    When the trace-day count takes them
    Then both are counted, and the row keeps the newer one's time

  @unit @integration
  Scenario: Root spans of one project and day are written as one increment
    Given root spans of one project queued on one UTC day
    When the queue drains them as one batch
    Then the day's row gets one upsert adding their trace and failed-trace counts
    And two writers adding to one day at once lose no count

  @unit
  Scenario: A redelivered batch may count its traces twice
    Given a batch of root spans added to its project's day
    When the same batch is delivered again, or retried after its write committed
    Then its traces are counted again
    And this is accepted: the counts steer emails, and an exact dedupe costs a row per trace

  @unit
  Scenario: Folds keyed across aggregates never re-fold from one aggregate's log
    Given a fold whose row sums many owner aggregates, a project
    When an event older than the row's newest arrives
    Then it is folded on as it comes, since a re-fold would rebuild the row from one aggregate

  @unit
  Scenario: Traces sync an organization at most once per 15 minutes
    Given traces arrive in two projects of one organization within 15 minutes
    Then they share one sync, one group call
    And a trace fact from before facts named their organization syncs on its project instead

  @unit
  Scenario: The organization's traits sum its projects' trace days
    Given trace days of an organization's projects, some older than the 30-day window
    When the organization syncs
    Then trace_count, error_count, last_trace_date and last_failed_trace_at come from the days in the window

  @unit @integration
  Scenario: Trace days older than the window are deleted
    Given a project's trace day older than the 30-day window
    When its organization syncs
    Then that day's row is deleted

  @unit
  Scenario: The organization's traits sum its projects
    Given an organization with two projects with usage and its trace counts
    When the traits are built
    Then prompt, evaluator, scenario, simulation set, trace and error counts are summed
    And last_trace_date and last_failed_trace_at are the newest trace and failed trace in Unix seconds
    And active_last_7_days, back_since_day_0, has_scenario_run and window_end_date are set

  @unit
  Scenario: The organization's activity on signup days 0, 1, 12 and 13 is a trait each
    Given an organization that signed up 13 days ago, with traces on days 0, 12 and 13
    When the traits are built
    Then active_day_0, active_day_12 and active_day_13 are true and active_day_1 is false

  @unit
  Scenario: A signup day that left the window is not sent
    Given an organization that signed up 40 days ago
    When the traits are built
    Then active_day_0 and active_day_1 are left out, so Customer.io keeps their last values
    And active_day_12 and active_day_13 are sent

  @unit
  Scenario: A habit is activity on 3 or more days at least 7 days apart, or in 3 ISO weeks
    Given an organization's active days within the window
    When the traits are built
    Then has_habit is true for 3 or more distinct UTC days whose first and last are 7 or more days apart
    And has_habit is true for activity in 3 or more distinct ISO weeks
    And has_habit is false otherwise

  @unit
  Scenario: Prompt versions, scenario runs and evaluations count toward the habit
    Given an organization with traces on one day
    And prompt-version, scenario-run or evaluation days on others within the window
    When the traits are built
    Then has_habit counts every kind's days together, each day once

  @unit
  Scenario: A changed project sends its organization's traits as one group call on the admin
    Given a project placed in an organization with an admin
    When the project's usage changes
    Then Customer.io receives one group call on the admin with the organization's traits

  @unit
  Scenario: A project placed in no organization sends nothing
    Given a project its owners place in no organization
    When the project's usage changes or it traces
    Then Customer.io receives nothing

  @integration
  Scenario: Each owner's fold keeps its own row per project
    Given the prompt fold and the scenario fold each store a row for the same project
    Then each owner's row is read back apart, with the event ids of its last delivery

  @integration
  Scenario: A row of another projection version is never counted, nor folded over
    Given a stored row of an older projection version
    Then the fold store reads it as undecodable, which the executor refuses to fold over
    And the organization's read leaves it out

  @integration
  Scenario: The organization's rows are read for its projects only
    Given rows for a project of the organization and for another project
    When the organization's rows are read for its projects
    Then every owner's row of its projects is returned and no other
