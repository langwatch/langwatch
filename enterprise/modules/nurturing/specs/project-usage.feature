Feature: Per-email usage reaches Customer.io from nurturing's own project rows

  Nurturing folds the owners' prompt, evaluator, scenario and simulation-run events into its own
  table (peer folds, ARCHITECTURE §9). A peer fold re-folds from one owner's event log, so there
  are four folds, one per owner pipeline, each keeping its own row per project. Evaluations add
  their UTC day to one more row per project, at most once a day. Traces are counted by a fifth
  peer fold over trace's span_received, which queues root spans only: a root span is one trace,
  a root span with an error status one failed trace, as trace's own rollup counts them, on one
  row per project and UTC day of append time, kept 30 days. No span body reaches nurturing. Each
  project is seeded once from trace's rollup with the traces before the fold's first one. A span carries no price, so the
  window's cost is read from trace's rollup at most once per organization and UTC day. When a
  project's usage changes, or its organization traced (throttled to once per 15 minutes),
  nurturing places it in its organization through the owners' shares, sums the organization's
  projects and sends their traits to Customer.io as one group call on the admin. It never pulls
  owner state on a schedule, and sends counts and times only, never content. flagged_count waits
  on its definition.

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
    Given spans of a project's traces appended on one UTC day
    When the trace-day fold takes them
    Then each root span adds one trace to the project's row for that day, and a child span none
    And a span appended on the next UTC day counts on the next day's row

  @unit
  Scenario: Only a root span mints a trace-day job
    Given a trace's root span and its child spans
    When trace appends them
    Then only the root span is queued to the trace-day fold, so a trace is one job and one write

  @unit
  Scenario: A failed trace is a root span with an error status
    Given a root span and a child span with an error status, and a root span without one
    When the trace-day fold takes them
    Then the day counts 2 traces and 1 failed trace, and the failed one's time

  @unit
  Scenario: Spans arriving out of order count the same
    Given two traces' root spans of one project and day, the older arriving after the newer
    When the trace-day fold takes them
    Then both are counted, and the row is never re-folded from one trace's log

  @unit
  Scenario: A redelivered span counts once
    Given a root span folded into its project's day
    When the same span is delivered again
    Then the day still counts it once

  @unit
  Scenario: Folds keyed across aggregates never re-fold from one aggregate's log
    Given a fold whose row sums many owner aggregates, a project or a project's day
    When an event older than the row's newest arrives
    Then it is folded on as it comes, since a re-fold would rebuild the row from one aggregate

  @unit @integration
  Scenario: A project that traced before the fold started is seeded once from trace's rollup
    Given a project with traces in the 30-day window that the trace-day fold never saw
    When its organization first syncs
    Then trace's per-day rollup of the project is read once and kept as the project's seed
    And its days are summed with the fold's, and later syncs read the kept seed, not the rollup

  @unit
  Scenario: The fold's first day counts traces before and after the fold started, each once
    Given a project's first trace the fold saw was appended at 10:30:20 on a day
    And the rollup holds 2 of that day's traces before 10:30 and the 3 the fold counted
    When the project is seeded
    Then the seed takes the rollup's minutes before 10:30 only, and the day counts 5 traces

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
  Scenario: The window's cost is read from trace once per organization and UTC day
    Given an organization that traced within the window
    When it syncs twice in one UTC day
    Then trace's per-day rollup is read for its cost on the first sync only
    And a refused group call gives the day's read back, so the retry reads it again

  @unit
  Scenario: A sync that read no cost leaves total_cost as Customer.io has it
    Given the organization's cost was already read this UTC day
    When the traits are built
    Then total_cost is left out and every count is sent

  @unit
  Scenario: The organization's traits sum its projects
    Given an organization with two projects with usage, its trace counts and its cost
    When the traits are built
    Then prompt, evaluator, scenario, simulation set, trace and error counts and total cost are summed
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
    Then Customer.io receives nothing and trace's cost is not read

  @integration
  Scenario: Each owner's fold keeps its own row per project
    Given the prompt fold and the scenario fold each store a row for the same project
    Then each owner's row is read back apart, with the event ids of its last delivery

  @integration
  Scenario: A row of another projection version is re-folded, never counted
    Given a stored row of an older projection version
    Then the fold store reads it as undecodable, so the executor re-folds it from the owner's log
    And the organization's read leaves it out

  @integration
  Scenario: The organization's rows are read for its projects only
    Given rows for a project of the organization and for another project
    When the organization's rows are read for its projects
    Then every owner's row of its projects is returned and no other
