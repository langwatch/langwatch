Feature: Detect and display stalled scenario runs
  As a LangWatch user
  I want stalled scenario runs to be detected and clearly distinguished from active runs
  So that I understand when a run will never complete due to infrastructure issues

  # Historical audit context lives in AUDIT_MANIFEST.md; the read-time
  # scenarios it mapped to stall-detection.unit.test.ts are gone with that
  # file. The one remaining @unimplemented scenario is pending E2E coverage
  # in PR #3458.

  # Context: When a worker dies (OOM, container kill, stalled job) the RUN_FINISHED
  # event never reaches the event store. Without detection, these runs appear as
  # "in progress" forever.
  #
  # The simulation_run_execution process manager's stall watchdog is the only
  # mechanism (ADR-094): queued/started/activity events arm a wake at
  # lastActivity + STALL_THRESHOLD_MS (2x the child-process timeout, so it
  # covers all reasonable completion scenarios), and a wake that finds the run
  # quiet past the threshold writes a real terminal finished(ERROR, "stalled")
  # event. Stored status is the only truth — the legacy read-time STALLED
  # derivation (stall-detection.ts) is deleted; the STALLED enum member
  # remains only for external API/UI compatibility and legacy stored rows.

  # ============================================================================
  # Stall Watchdog Logic - Unit Tests
  # ============================================================================
  # Pure logic: given a run quiet past the deadline, the wake finishes it.

  @unit
  Scenario: Run quiet past the stall threshold finishes ERROR
    Given a scenario run has had no activity for longer than the stall threshold
    And no RUN_FINISHED event exists
    When the stall watchdog wake fires
    Then the run finishes with status ERROR and reason "stalled"

  # A run reported from outside opens with RUN_STARTED: only the platform
  # emits QUEUED. The watchdog must decide the stall from the activity the
  # process really saw, not from the identity only the queued path stamps,
  # or a CI machine that dies mid-run leaves the run in progress forever.
  @unit
  Scenario: An externally reported run quiet past the threshold is finished as stalled
    Given a run reported by an SDK from outside the platform, so no queued event exists
    And the reporting process died before it sent a finished event
    When the stall watchdog wake fires after the threshold of silence
    Then the run finishes with status ERROR and reason "stalled"
    And a run still sending activity keeps its wake armed instead

  # The watchdog only puts the reason on its finish command; the command is
  # what must carry it onto the recorded event, or the run shows an error
  # with no explanation.
  @unit
  Scenario: The stall reason is recorded on the terminal event
    Given the stall watchdog finishes a run with a bare error reason
    And no judge results accompany the finish command
    When the finish command emits the terminal event
    Then the event carries failure results encoding that reason

  # ============================================================================
  # End-to-End - User Workflow
  # ============================================================================
  # Full user-visible flow: user sees a stalled run and understands what happened.

  @e2e @unimplemented
  Scenario: User sees a stalled run as errored, not spinning forever
    Given I am logged into project "my-project"
    And scenario "Flaky Agent" had a run that stopped making progress
    And that run has since been recorded as errored
    When I view the run history for "Flaky Agent"
    Then I see the run displayed with an error indicator
    And the run is not shown as actively in progress
