Feature: Per-email usage reaches Customer.io from nurturing's own project rows and trace's rollup

  Nurturing folds the owners' prompt, evaluator, scenario and simulation-run events into its own
  table (peer folds, ARCHITECTURE §9). A peer fold re-folds from one owner's event log, so there
  are four folds, one per owner pipeline, each keeping its own row per project. Evaluations add
  their UTC day to one more row per project, at most once a day. Traces are not copied: trace's
  existing trace_received fact, throttled per organization to once per 15 minutes, starts one
  read of trace's own per-minute rollup (trace_analytics_rollup) for the organization's projects
  over the last 30 days. When a project's usage changes, nurturing places it in its organization
  through the owners' shares, sums the organization's projects and sends their traits to
  Customer.io as one group call on the admin. A sync no trace started sends no trace trait. It
  never pulls owner state on a schedule, and sends counts and times only, never content.
  flagged_count waits on its definition.

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

  @unit
  Scenario: Traces sync an organization at most once per 15 minutes
    Given traces arrive in two projects of one organization within 15 minutes
    Then they share one sync, which reads trace's rollup once
    And a trace fact from before facts named their organization syncs on its project instead

  @unit
  Scenario: The organization's traces are read from trace's rollup
    Given a trace sync for a project of an organization
    When the organization syncs
    Then trace's per-day rollup is read once for all its projects over the last 30 days
    And the days are summed into trace_count, error_count and total_cost

  @unit
  Scenario: A sync no trace started leaves the trace traits as Customer.io has them
    Given an owner fact changed a project's row
    When its organization syncs
    Then no trace is read and no trace trait is sent, so Customer.io keeps their last values

  @unit
  Scenario: The organization's traits sum its projects
    Given an organization with two projects with usage, and its traces' totals
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
    Then Customer.io receives nothing and no trace is read

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
