Feature: Platform administration package boundary
  Platform-admin access and impersonation are explicitly composed.

  @unit
  Scenario: Admin email matching is normalized
    Given an allow-list with mixed case, spaces, and blanks
    When platform-admin access checks an email
    Then matching is case-insensitive and blanks are ignored

  @unit
  Scenario: An admin cannot impersonate another admin
    Given the target email is in the platform-admin allow-list
    When an admin starts impersonation
    Then the service reports cannot_impersonate_admin without changing session state

  @unit
  Scenario: An operator cannot hop from one impersonation straight into another
    Given the acting session already carries an unexpired impersonation window
    When an admin starts impersonation of somebody else
    Then the service reports cannot_reimpersonate_while_impersonating
    And no target is looked up and nothing is audited

  @unit
  Scenario: A healthy target receives a bounded session window
    Given a healthy non-admin target
    When an admin starts impersonation with a reason
    Then the attempt is audited and the session window expires after one hour

  @unit
  Scenario: Blob listing reports sampled ordering honestly
    Given an operator requests a ranked blob listing
    When Redis returns a bounded sample
    Then the result reports the sample size and rankedFromSample

  @unit
  Scenario: Blob deletion refuses a live lease atomically
    Given a blob still has a live lease
    When an operator requests deletion
    Then the bytes remain and the result reports deleted as false

  @integration
  Scenario: The Ops dashboard stream starts with the current snapshot
    Given a readable current Ops snapshot
    When an authorized subscriber opens the dashboard stream
    Then the current snapshot is delivered before waiting for the next update
    And every dashboard response field remains present

  @unit
  Scenario: A manual scheduler run follows the ordinary due path
    Given an active report schedule
    When an operator requests an immediate run
    Then automation's report schedule is asked for one run rather than the target being invoked
    And the control is audited once the command is accepted

  @unit
  Scenario: Scheduler controls refuse what a report schedule cannot do
    Given a report schedule with no run in flight
    When an operator asks to clear its stuck slot
    Then the service refuses with its stable scheduler error
    And no audit entry is written for the refused control

  # ADR-090: the writer runs in every serving role so dashboard freshness never
  # depends on worker health; one pod holds the lease and publishes for all.
  @unit
  Scenario: The queue-metrics writer contends for the lease in every serving role
    Given Ops is installed in an api or a worker process
    When the process starts
    Then the queue-metrics writer contends for the snapshot lease
    And stopping the process hands the lease back before the stores close

  @unit
  Scenario: The daily usage report is one report for the whole install
    Given a self-hosted install carrying two organizations
    When the daily usage report is posted
    Then one daily_usage_stats report goes out under the install's minted identity
    And the answer is written down, so a refused report shows on the checkup page

  # The Ops workspace and the Back office are gated separately on purpose, and
  # the page shells that carried the two checks said so out loud: widening
  # operator access must never widen the Back office, which reads and writes
  # every tenant's rows. Both are platform-tier grants — `ops:view` reads,
  # `ops:manage` writes — so the distinction is the registry's, not a page's.

  @integration
  Scenario: An operator sees the Ops workspace
    Given a reader holding the operator view grant
    When they open a page of the Ops workspace
    Then the page opens

  @integration
  Scenario: A reader without the operator grant is refused and told which grant
    Given a reader holding no operator grant
    When they open a page of the Ops workspace
    Then they are refused and the grant they lack is named

  @integration
  Scenario: The Back office stays narrower than the workspace
    Given a reader holding the operator view grant and not the manage grant
    When they open a Back office resource
    Then they are refused even though the Ops workspace opens for them

  @unit
  Scenario: A concurrent replay start reports the stable conflict
    Given a replay lock is already held
    When an operator starts another replay
    Then replay_already_running reports the existing 409 operator message
    And the current replay status is unchanged

  @unit
  Scenario: A replay start failure keeps its stable operator error
    Given replay startup storage fails after the lock is acquired
    When an operator starts a replay
    Then replay_start_failed reports the existing 409 safe operator message
    And the original failure remains available for platform logging
