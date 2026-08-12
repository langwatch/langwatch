# See dev/docs/adr/091-operator-control-over-the-scheduler.md for the
# architectural rationale — in particular why a manual run makes the schedule
# DUE and lets the calendar loop claim it through its ordinary Postgres
# conditional-update lease, rather than invoking the target handler or
# claiming the slot inside the ops request.

Feature: Operator control over the scheduler
  As an operator responsible for schedule-triggered work across every project
  I want to see that the scheduler is behind and repair it from the same screen
  So that a wedged customer-facing report is not fixed by hand-editing Postgres

  Context: the scheduler page listed nine columns of durable ScheduledJob state
  and offered no controls, by an explicit code-level constraint ("never a firing
  path"). It could not say the scheduler was behind — an overdue row differed
  from a healthy one by the words "ago" and "in" inside a long timestamp string,
  in no particular sort order — it named projects and targets by raw ksuid, and
  when a slot stuck the only remedy was a manual database write with no audit,
  no permission gate and no idempotency. The controls below replace that remedy
  with a fenced, audited, permissioned one; the read-only default stands.

  Background:
    Given an operator with the ops view permission is on the scheduler page

  # ── Seeing that the scheduler is behind ───────────────────────────────

  @unit
  Scenario: An overdue schedule reads as overdue, not as a timestamp
    Given a schedule whose next run is in the past
    When the page renders
    Then its status reads as overdue
    And it states how late it is

  @unit
  Scenario: Overdue and failing schedules sort above healthy ones
    Given an overdue schedule, a retrying schedule, and several healthy ones
    When the page renders
    Then the overdue and retrying schedules appear first

  @unit
  Scenario: The header counts what needs attention
    Given two overdue schedules, one retrying, and thirty-one active
    When the page renders
    Then the header reports the overdue count, the failing count, and the active count

  @unit
  Scenario: A stalled calendar loop is the headline, not a row detail
    Given the calendar loop has not ticked within its liveness threshold
    When the page renders
    Then the header reports the loop as unhealthy with the time of its last tick

  @unimplemented
  Scenario: Schedules are named, not identified by ksuid
    Given a schedule for a target in a project
    When the row renders
    Then the project and target are shown by name
    And their identifiers are available to copy rather than displayed

  # ── Permission ────────────────────────────────────────────────────────

  @unimplemented
  Scenario: Viewing does not grant control
    Given an operator holding only the ops view permission
    When the page renders
    Then no control that mutates a schedule is offered

  @unimplemented
  Scenario: A control refuses a caller without the manage permission
    Given a caller holding only the ops view permission
    When it attempts to pause a schedule
    Then the attempt is refused

  # ── Pause and resume ──────────────────────────────────────────────────

  @unimplemented
  Scenario: Pausing stops future runs
    Given an active schedule with no slot in flight
    When the operator pauses it
    Then it is marked inactive
    And the calendar loop does not claim its next slot

  @unimplemented
  Scenario: Pausing says what it does not do
    Given a schedule with a slot already in flight
    When the operator pauses it
    Then the confirmation states that the in-flight run continues

  @unimplemented
  Scenario: Resuming returns the schedule to the calendar
    Given a paused schedule
    When the operator resumes it
    Then it is marked active
    And its next run is computed from its schedule rather than back-filled

  # ── Clearing a stuck slot ─────────────────────────────────────────────

  @unit
  Scenario: Clearing is offered only once a slot is genuinely stale
    Given a schedule whose slot was claimed moments ago
    When the row's actions are opened
    Then clearing the slot is not offered

  @unimplemented
  Scenario: Clearing a stale slot lets the schedule be claimed again
    Given a schedule whose slot has been held past the staleness threshold
    When the operator clears it
    Then the slot is released
    And the schedule can be claimed on the next tick

  @unimplemented
  Scenario: Clearing states the risk it carries
    Given a schedule whose slot has been held past the staleness threshold
    When the operator opens the clear confirmation
    Then it states that a still-live original worker could result in the slot being worked twice

  # ── Running now ───────────────────────────────────────────────────────

  @unimplemented
  Scenario: The confirmation names the tenant, not its identifier
    Given a schedule belonging to a project
    When the operator opens the run-now confirmation
    Then the project name and the target are stated

  @integration
  Scenario: A manual run goes through the ordinary path
    Given an active schedule
    When the operator runs it now
    Then the schedule is made due rather than the target being invoked directly
    And the calendar loop claims and runs it as it would a scheduled slot

  @unimplemented
  Scenario: A manual run is visible as a run
    Given a manual run is in progress
    When the page renders
    Then the schedule shows as running
    And a failure increments its attempts and records its error like any other run

  @integration
  Scenario: A manual run racing the calendar loop runs once
    Given an active schedule whose slot the calendar loop claims concurrently
    When the operator runs the same slot now
    Then exactly one of the two claims proceeds
    And the other stands down without invoking the target

  @integration
  Scenario: An inactive schedule refuses to run
    Given a paused schedule
    When the operator attempts to run it now
    Then the attempt is refused with a reason naming the schedule as inactive
    And no slot is claimed

  # Deliberately narrowed during implementation: moving the schedule's due
  # instant fires its NEXT slot, and cannot express "fire that past slot
  # again". Replaying a delivery is the one shape of this control that
  # intentionally sends a customer the same artifact twice, so it is not
  # offered here at all rather than offered behind a second confirmation.
  @unimplemented
  Scenario: A slot that has already fired cannot be re-fired from here
    Given a slot that has already fired
    When the operator opens the schedule's actions
    Then no control offers to run that past slot again

  # ── Audit ─────────────────────────────────────────────────────────────

  @integration
  Scenario: Every control writes an audit record
    Given an operator pauses a schedule, clears a slot, and runs a slot now
    When the audit trail is read
    Then each action is recorded with its actor, schedule, slot, project, and time

  @unimplemented
  Scenario: Recent operator actions are visible on the page
    Given an operator ran a schedule manually
    When the page renders
    Then that action is visible without leaving the page

  # ── Failures are named ────────────────────────────────────────────────

  @unit
  Scenario: A refused control explains itself in the operator's terms
    Given a control is refused because the schedule is inactive
    When the refusal reaches the page
    Then the operator is shown copy naming the cause and what to do
    And no generic unknown-error message is shown

  @unit
  Scenario: A run refused by a concurrent pause says the schedule is paused
    Given an active schedule the operator has chosen to run now
    And another operator pauses it before the write lands
    When the run is refused
    Then the reason names the schedule as inactive
    And it does not claim the scheduler took the slot first

  @unit
  Scenario: A control that changed nothing is not recorded as though it did
    Given a schedule that is deleted between being read and being paused
    When the pause affects no rows
    Then the operator is told the schedule no longer exists
    And no audit record is written for the pause

  # ── Acting on the right row ───────────────────────────────────────────

  @unit
  Scenario: A control names its project in the write, not only in the copy
    Given an operator acts on a schedule
    When any control writes to the row
    Then the write is scoped to that schedule's project
    And a schedule belonging to another project cannot be reached

  @unit
  Scenario: Pausing a wedged schedule does not withdraw the repair
    Given a schedule whose slot has been held long enough to clear
    When an operator pauses it first
    Then clearing the stuck slot is still offered
    And the staleness clock is not restarted by the pause
