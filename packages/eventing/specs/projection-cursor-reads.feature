# Draft. Design: .claude/handoffs/projection-cursor-design.md, Revision 2 (Alex's ruling, 2026-10-01;
# dev/docs/ARCHITECTURE.md "Projection cursor reads"). Every scenario is @unimplemented until bound.
Feature: A read served from projections answers by cursor
  A tRPC read declares the projections it is served from. Each named projection keeps a cursor per
  (projection, tenant) and per (projection, key) in the Postgres process store: the newest event id
  (a k-sortable KSUID) it has applied, or none. A cursor only ever moves to a value it has never held, or to none, and
  none never matches. The tRPC host checks access first, reads the cursors, then compares the caller's
  version with them by equality: equal answers `unchanged` without running the read; otherwise the read
  runs and answers its data with the version of the cursors read before it ran.

  Background:
    Given a pipeline "run_processing" with a fold projection "runState" keyed by run id
    And a contract read "runs.get" with input "projectId" and "runId"
    And "runs.get" declares it is served from "runState" keyed by "runId"
    And a contract read "runs.list" served from "runState" for its tenant

  # Contract and boot

  @unit
  Scenario: A read declares the projections it is served from
    When the contract is built
    Then "runs.get" carries "runState" with key field "runId"
    And "runs.list" carries "runState" with no key field
    And a read that declares none carries no projections

  @unit
  Scenario: A read naming a projection no installed pipeline registers is refused at boot
    Given "runs.get" declares it is served from "runStatus"
    And no installed pipeline registers a projection "runStatus"
    When the worker boots
    Then boot fails with a configuration error naming "runs.get" and "runStatus"

  @unit @unimplemented
  Scenario: A key field the read's input does not have is refused at boot
    Given "runs.get" declares key field "scenarioRunId"
    And the input of "runs.get" has no field "scenarioRunId"
    When the process boots
    Then boot fails with a configuration error naming "runs.get" and "scenarioRunId"

  @unit @unimplemented
  Scenario: A read with no tenant scope cannot be served from a projection
    Given a public read declares it is served from "runState"
    When the process boots
    Then boot fails with a configuration error naming the read and saying it has no tenant scope

  @unit @unimplemented
  Scenario: A projection name two installed pipelines register is refused when a read names it
    Given two installed pipelines each register a projection "runState"
    When the worker boots
    Then boot fails with a configuration error naming both pipelines

  @integration @unimplemented
  Scenario: A cursor-backed read that touches state outside its projections fails its test
    Given "runs.get" also reads a Postgres table no projection writes
    When the installation test calls "runs.get" on the memory stores
    Then the call fails naming "runs.get" and the store it touched

  # Library: advancing the cursor

  @unit @unimplemented
  Scenario: A projection no read names writes no cursor
    Given a fold projection "runAudit" that no read declares
    When an event for "run_1" is applied to "runAudit"
    Then no cursor row exists for "runAudit"

  @unit @unimplemented
  Scenario: A job's advance sets the key and tenant cursors to the newest event it delivered
    Given the highest event "runState" has seen for "run_1" was accepted at 100
    When a job delivering events accepted at 150 and 200 for "run_1" stores its result
    Then the cursor of "run_1" and the cursor of tenant "project_1" are the event accepted at 200
    And the job is acknowledged only after the cursors were written

  @unit @unimplemented
  Scenario: An advance that fails fails its job
    Given the process store refuses the cursor write
    When a job for "run_1" stores its result
    Then the job fails and is retried

  @unit @unimplemented
  Scenario: An apply of an earlier-accepted event after a later one still changes the tenant cursor
    Given run "run_2"'s event accepted at 200 was applied first
    And a version was issued for "runs.list" after that apply
    When run "run_1"'s event accepted at 100 is applied
    Then the tenant cursor is run "run_1"'s event
    And the issued version no longer matches

  @unit @unimplemented
  Scenario: An apply whose newest event is not above what the key has seen clears both cursors
    Given the highest event "runState" has seen for "run_1" was accepted at 200
    And a version was issued for "runs.get" and for "runs.list"
    When a late event for "run_1" accepted at 150 is folded
    Then the cursor of "run_1" and the cursor of tenant "project_1" are cleared
    And the highest event seen for "run_1" stays the one accepted at 200
    And neither issued version matches

  @unit @unimplemented
  Scenario: A cleared cursor matches nothing until the next apply above the key's highest event
    Given the cursor of "run_1" was cleared
    When the user calls "runs.get" twice with no apply in between
    Then the second call runs the read again
    And once an event above the highest seen for "run_1" is applied the next version issued can match

  @unit @unimplemented
  Scenario: A retried job whose first attempt stored but never advanced advances the cursors
    Given a job for "run_1" stored its result and failed before its advance
    And a version for "runs.list" was issued before that job ran
    When the retry folds nothing new
    Then the cursors are set to the newest event the job delivered
    And the issued version no longer matches

  @unit @unimplemented
  Scenario: A redelivery after its advance landed never restores an earlier cursor
    Given a job for "run_1" advanced the tenant cursor to its event "E1" and failed before acknowledging
    And a version for "runs.list" was issued while the tenant cursor was "E1"
    And a job for "run_2" then advanced the tenant cursor to "E2"
    When the job for "run_1" is redelivered and folds nothing new
    Then the tenant cursor is never "E1" again
    And the issued version no longer matches

  @unit @unimplemented
  Scenario: Concurrent applies in one tenant leave the last writer's event and never an earlier value
    Given jobs for "run_1" and "run_2" advance the tenant cursor at the same time
    When both have committed
    Then the tenant cursor is the event of whichever committed last
    And no version issued before either commit matches

  @unit @unimplemented
  Scenario: A rebuild of a lost lane clears the cursors of the key it rebuilds
    Given the highest event "runState" has seen for "run_1" is "E9"
    And event "E5" for "run_1" never reached the projection
    When the rebuild job for "run_1" folds its history again
    Then the cursor of "run_1" and the cursor of tenant "project_1" are cleared

  @unit @unimplemented
  Scenario: A projection replay clears the tenant's cursors when it starts and when it ends
    Given a version issued for "runs.get" and for "runs.list" before a replay of "runState" for "project_1"
    When the replay starts
    Then the replayed keys' cursors and the tenant cursor are cleared
    And when the replay ends they are cleared again and a read hint is sent
    And the highest event seen for each key is unchanged

  @unit @unimplemented
  Scenario: A new projection definition version makes every held version stale
    Given the user holds the current version of "runs.get"
    When "runState" is deployed with a new definition version
    Then the held version no longer matches

  @integration @unimplemented
  Scenario: Cursors survive a restart of every process
    Given the user holds the current version of "runs.get"
    When the api and the worker restart with nothing applied in between
    Then the held version still matches

  # Framework: the check, in order

  @integration @unimplemented
  Scenario: A caller without the permission is refused even when its version matches
    Given a user who lost "runs:view" on "project_1" holds a matching version
    When the user calls "runs.get" with that version
    Then the call is refused with a forbidden error
    And the read does not run and no cursor is read

  @integration @unimplemented
  Scenario: An unauthenticated caller is refused before any cursor is read
    When an anonymous caller calls "runs.get" with a version
    Then the call is refused with an unauthorised error

  @integration @unimplemented
  Scenario: A caller holding the current version is answered unchanged without running the read
    Given the user called "runs.get" and was answered a version
    And nothing was applied to "runState" since
    When the user calls "runs.get" with that version
    Then the answer is `{ unchanged: true }`
    And the read's handler was not called

  @integration @unimplemented
  Scenario: A caller without a version is answered the data and its version
    When the user calls "runs.get" without a version
    Then the answer carries the handler's data and a version

  @integration @unimplemented
  Scenario: The version carries the cursors read before the read ran
    Given the user calls "runs.get" without a version
    And an event for "run_1" is stored and advanced while the handler runs
    When the user calls "runs.get" again with the version it was answered
    Then the read runs again and answers its data

  @integration @unimplemented
  Scenario: A version a grant change has passed is answered with fresh data
    Given the user holds the current version of "runs.list"
    When a grant change for the user is projected and the session version is bumped
    And the user calls "runs.list" with the held version
    Then the read runs and answers its data with a new version

  @integration @unimplemented
  Scenario: A ClickHouse-backed cursor inside its settle window issues a version that never matches
    Given "runState" is stored in ClickHouse with a settle window of 5 seconds
    And an advance wrote its cursor 1 second ago by the process store's clock
    When the user calls "runs.get" twice with no apply in between
    Then the second call runs the read again
    And once the window has passed the next version issued matches

  @integration @unimplemented
  Scenario: A Postgres state projection's cursor can match as soon as it is written
    Given "topicRunHistory" is a Postgres state projection with no settle window
    And a read "topics.history" is served from it
    When the user calls "topics.history" twice with no apply in between
    Then the second call is answered unchanged

  @integration @unimplemented
  Scenario: A version is bound to its user, its procedure and its input
    Given the user holds the current version of "runs.get" for run "run_1"
    Then the same version sent for run "run_2", by another user or to "runs.list" does not match

  @integration @unimplemented
  Scenario: A version that cannot be decoded is treated as no version
    When the user calls "runs.get" with version "not-a-version"
    Then the read runs and answers its data with a version

  @integration @unimplemented
  Scenario: An unreachable cursor store answers the data with a version that never matches
    Given the process store does not answer the cursor read
    When the user calls "runs.get" with a held version
    Then the read runs and answers its data
    And the version it carries matches no later request

  @integration @unimplemented
  Scenario: A read served from two projections changes version when either advances
    Given "runs.detail" is served from "runState" and "runResults" keyed by "runId"
    And the user holds the current version of "runs.detail"
    When only "runResults" applies an event for that run
    Then the held version no longer matches

  # Wire

  @integration @unimplemented
  Scenario: The version travels as "since" and is never handed to the handler
    When the user calls "runs.get" with "since" in its input
    Then the handler is handed the input without "since"

  @integration @unimplemented
  Scenario: Batched reads answer each envelope on its own
    Given a batch of "runs.get" with a current version and "runs.list" with a stale one
    When the batch is answered
    Then "runs.get" answers unchanged and "runs.list" answers data and a version

  @integration @unimplemented
  Scenario: A read hint for a cursor-backed read is published only after the cursor advanced
    Given "runs.get" is mounted in the focused tab
    When an event for "run_1" is applied
    Then the hint for "runs.get" is published after the cursor of "run_1" was written

  @unit
  Scenario: A cursor-backed read cannot also declare event-bound hints
    Given "runs.get" declares it is served from "runState"
    And "runs.get" also declares it is invalidated by an event type
    When the process boots
    Then boot fails with a configuration error naming "runs.get"
