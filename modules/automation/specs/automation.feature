Feature: Automation ownership

  @unit
  Scenario: One automation capability owns subordinate lifecycles
    Given the automation service
    When trigger definitions, trigger-fire history, report schedules, and email suppression are used
    Then they share the singular automation ownership boundary
    And callers do not select separate trigger or suppression services

  @unit
  Scenario: Automations are scoped to a project
    Given an automation service
    When an automation is read by id and project
    Then it returns only the automation belonging to that project

  @unit
  Scenario: Project-wide email suppression applies to a trigger
    Given an email suppressed for a project
    When recipients are filtered for a trigger in that project
    Then the suppressed address is removed regardless of casing

  @unit
  Scenario: Email delivery caps are idempotent across retries
    Given a logical automation email dispatch has consumed a cap slot
    When its outbox delivery retries with the same deduplication key
    Then Automation re-reads the cap without consuming another slot
    And the per-project daily cap counts recipients rather than dispatches

  @unit
  Scenario: Missing report schedules are repaired without resuming paused reports
    Given an active report trigger without a schedule process
    And another report trigger whose schedule process is paused
    When the automation service reconciles report schedules
    Then it configures the missing schedule once, however often it runs
    And it leaves the paused schedule inactive

  @unit
  Scenario: A saved report is scheduled for its next cron slot
    Given a report that sends daily at 09:00 UTC
    When it is saved at 08:00
    Then its schedule process wakes at 09:00 the same day

  @unit
  Scenario: A report fires at its cron time
    Given a report scheduled for 09:00
    When the clock reaches 09:00
    Then the 09:00 slot is sent through the outbox
    And the schedule wakes again at the next day's 09:00

  @unit
  Scenario: A paused report does not fire
    Given a report scheduled for 09:00
    When it is paused before 09:00
    Then its schedule holds no wake and a stray wake sends nothing

  @unit
  Scenario: A resumed report fires at its next cron slot
    Given a paused report
    When it is resumed after its missed slot
    Then its schedule wakes at the next slot, not the missed one

  @unit
  Scenario: Run now sends the report once and keeps the cadence
    Given a scheduled report
    When an operator asks for a run now twice with the same request
    Then the report is sent once
    And its next scheduled send is unchanged

  @unit
  Scenario: The automations page reads a report's next and last run from its schedule
    Given a saved report
    When the automations page lists report schedules
    Then the next run is the schedule process's armed wake
    And a paused report shows no next run

  @unit
  Scenario: The operator scheduler lists every report's schedule across projects
    Given reports in two projects, one of them paused by an operator
    When the operator scheduler asks automation for its report schedules
    Then each configured report is listed with its project, cron, timezone and active state
    And the paused one shows no next run

  @unit
  Scenario: An operator's pause and resume drive the report's schedule
    Given a scheduled report
    When an operator pauses its schedule and later resumes it
    Then the schedule holds no wake while paused
    And it wakes at the next cron slot once resumed

  @unit
  Scenario: Each operator run-now is its own request
    Given a scheduled report
    When an operator asks for a run now, and again once the first was sent
    Then each request sends the report
    And its next scheduled send is unchanged

  @unit
  Scenario: A run-now asked for while another is in flight sends nothing
    Given a report whose run-now has been neither sent nor finally failed
    When another run-now is asked for
    Then nothing more is dispatched
    And the report is sent once

  @unit
  Scenario: A run-now settles when its report is sent or finally fails
    Given a run-now being dispatched
    When the report is sent, or its final delivery attempt fails
    Then the report's schedule records the run as settled
    And the next run-now is accepted
    But a failure that will be retried leaves the run in flight

  @unit
  Scenario: A scheduled send supersedes a run-now that never settled
    Given a run-now whose settlement was never recorded
    When the report's next scheduled slot fires
    Then the slot is sent
    And run-now is accepted again

  @unit
  Scenario: The operator scheduler lists paused reports and leaves deleted ones out
    Given a report paused by its customer, one paused before it was ever scheduled, and a deleted one
    When the operator scheduler asks automation for its report schedules
    Then both paused reports are listed as inactive with their cron
    And the deleted report is not listed

  @unit
  Scenario: The operator scheduler shows a run-now in flight until it settles
    Given a report with a run-now being dispatched
    When the operator scheduler asks automation for its report schedules
    Then the report shows the run's slot as in flight
    And once the run settles it no longer does

  @unit
  Scenario: The api sends report schedule commands but never runs the schedule
    Given a process that installs the automation module over memory stores
    When the process boots in the api role
    Then the report schedule process manager is named among those it will not run

  @integration
  Scenario: The api process removes an automation's report schedule through the pipeline's senders
    Given the api process, which holds no process store
    When a report is scheduled and then removed
    Then both commands are sent and neither refuses

  @unit
  Scenario: Reports are not dispatched as trace or graph triggers
    Given an active report trigger with a report source
    When active automation projections are loaded for dispatch
    Then the report trigger is absent from both trace and graph projections

  @unit
  Scenario: Persist-cap containment pauses a condition-less automation once
    Given a condition-less trace automation has exceeded its daily persist cap
    When runaway containment evaluates the breach
    Then it claims the containment check before evaluating project traffic
    And it pauses the automation with the runaway reason
    And it sends at most one limit notification for the UTC day

  @unit
  Scenario: Persist-cap containment leaves a busy filtered automation active
    Given a filtered automation has exceeded its daily persist cap
    And its confirmed matches cover less than 90 percent of at least 100 project traces
    When runaway containment evaluates the breach
    Then it leaves the automation active
    And it sends at most one ceiling notification for the UTC day

  @unit
  Scenario: A plan's own ceiling wins over the free/paid/enterprise bucket
    Given a project on a plan that carries its own automation ceiling
    When the daily persist ceiling is resolved
    Then the plan's own ceiling is used instead of the type bucket

  @unit
  Scenario: A ceiling-reached notice offers the next tier
    Given a filtered automation has exceeded its daily persist cap
    When runaway containment sends its ceiling notification
    Then the notice carries the organization's next self-serve tier

  @unit
  Scenario: A ceiling notice sent from the background process offers the same next tier
    Given an automation past its daily ceiling on a deployment that prices its plans
    When the background process that settles automations sends the ceiling notification
    Then the notice offers the organization's next self-serve tier at that tier's own price

  @unit
  Scenario: A paused runaway automation is never offered the next tier
    Given a condition-less trace automation has exceeded its daily persist cap
    When runaway containment pauses and notifies about it
    Then no next tier is resolved or offered in the pause notice

  @unit
  Scenario: Graph threshold evaluation uses the singular AutomationService
    Given an active graph trigger and its custom graph
    When Eventing evaluates the trigger with a real-time or heartbeat reason
    Then threshold, no-data, delivery, retry, and open-incident decisions run through AutomationService
    And the service claims at most one open graph incident per trigger

  @unit
  Scenario: Graph heartbeat isolates projects and metric sources
    Given graph triggers across trace-backed and evaluation-backed projects
    When the heartbeat checks recent slim-table activity
    Then it batches recency by project and source
    And a failed project does not suppress candidates for other projects

  @integration
  Scenario: Provider authoring uses one browser surface
    Given an automation provider contributes a configuration form
    When the drawer renders its variables and Monaco editors
    Then it uses the Automation web contracts and editor behaviour
    And application code retains only drawer and transport composition

  @unit
  Scenario: Test fire uses the automation service
    Given an authenticated automation author and a template draft
    When the author sends a test fire
    Then the composed AutomationService validates and renders the draft
    And provider delivery runs through the process-owned Automation delivery adapter

  @unit
  Scenario: A ceiling notice quotes the rung entitlement names next
    Given a project whose organization buys from the tiered ladder
    When the upgrade line of an automation ceiling notice is resolved
    Then it links the checkout of the rung the entitlement capability names next

  @unit
  Scenario: A trigger match refuses by name when this process hosts no automations pipeline
    Given a process that registered no automations pipeline
    When an evaluation reaction records a trigger match
    Then the match is refused naming the missing recordTriggerMatch sender

  @unit
  Scenario: A trigger match is recorded through the automations pipeline's own sender
    Given the automations pipeline registered and its senders connected
    When an evaluation reaction records a trigger match
    Then the match is sent through recordTriggerMatch

  @unit
  Scenario: An origin-guarded trace records a match per trace trigger that reads no evaluation
    Given a project with one trace-only automation and one whose filter reads evaluations
    When trace hands the automation API a settled trace
    Then one match is recorded, for the trace-only automation, with its action class and debounce

  @unit
  Scenario: A trace event with no aggregate records no match
    Given a project with an active trace automation
    When trace hands the automation API an event that names no trace
    Then no automation is read and no match is recorded
