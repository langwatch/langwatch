Feature: Per-email usage reaches Customer.io from nurturing's own project fold

  Nurturing folds the owners' prompt, evaluator, scenario and trace events into one row per
  project (a peer fold, ARCHITECTURE §9), in its own table. When a project's row changes, it
  places the project in its organization through the owners' shares, sums the organization's
  projects and sends their traits to Customer.io as one group call on the admin. It never pulls
  owner state on a schedule. flagged_count and has_habit wait on their definitions.

  @unit
  Scenario: Prompts and evaluators count up when created and down when deleted
    Given a project's fold has taken two prompt.created and one prompt.deleted for another prompt
    And one evaluator.created and its evaluator.deleted
    Then the project counts 2 prompts and 0 evaluators

  @unit
  Scenario: A trace counts once however many times its received fact arrives
    Given trace_received arrives three times for the same trace id
    Then the project counts 1 trace, with the latest error status and cost

  @unit
  Scenario: Traces older than 30 days drop out of the counts
    Given a trace received 31 days before the project's newest fact
    Then it is not counted in trace_count, error_count or total_cost

  @unit
  Scenario: A trace_received from before it carried a trace id counts as an active day only
    Given trace_received arrives without a trace id
    Then the project's active days include its UTC day and no trace is counted

  @unit
  Scenario: The organization's traits sum its projects
    Given an organization with two projects with usage
    When the traits are built
    Then prompt, evaluator, scenario, trace and error counts and total cost are summed
    And last_failed_trace_at is the newest failed trace in Unix seconds
    And active_last_7_days, back_since_day_0, has_scenario_run and window_end_date are set

  @unit
  Scenario: A changed project sends its organization's traits as one group call on the admin
    Given a project placed in an organization with an admin
    When the project's usage changes
    Then Customer.io receives one group call on the admin with the organization's traits

  @unit
  Scenario: A project placed in no organization sends nothing
    Given a project its owners place in no organization
    When the project's usage changes
    Then Customer.io receives nothing
