# Design: dev/docs/ARCHITECTURE.md "Projection cursor reads" (Alex's ruling, 2026-10-01).
# Scenarios without a binding tag are @unimplemented until bound.
Feature: A read served from projections answers by cursor
  A tRPC read declares the projections it is served from. Each named projection keeps a cursor per
  (projection, tenant) and per (projection, key) in the Postgres process store: the newest event id
  (a KSUID) it has applied, or none. The cursor only moves up, by string compare. The tRPC host
  checks access first, reads the cursors, then runs the read and answers its data in full with the
  cursor ids read before it ran. A cursor never shortens an answer: it decides freshness and keys
  the cache. A hint carries
  its event id; the tab treats an answer as fresh by the rule below and otherwise asks again until the
  settle window ends. The window only bounds how long the tab keeps asking; it never blocks a match.

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

  # Library: the cursor

  @unit @unimplemented
  Scenario: A projection no read names writes no cursor
    Given a fold projection "runAudit" that no read declares
    When an event for "run_1" is applied to "runAudit"
    Then no cursor exists for "runAudit"

  @unit @unimplemented
  Scenario: newestApplied answers an empty list for a key nothing was applied to
    When newestApplied is asked for "runState" of "project_1" and key "run_1"
    Then it answers an empty list

  @unit @unimplemented
  Scenario: A job's advance sets the key and tenant cursors to the newest event id it delivered
    Given the newest event "runState" has applied for "run_1" is "E1"
    When a job delivering events "E2" and "E3" for "run_1" stores its result
    Then newestApplied answers "E3" for "run_1" and "E3" for tenant "project_1"
    And the job is acknowledged only after the cursors were written

  @unit @unimplemented
  Scenario: An advance that fails fails its job
    Given the process store refuses the cursor write
    When a job for "run_1" stores its result
    Then the job fails and is retried

  @unit @unimplemented
  Scenario: An advance never lowers a cursor
    Given the tenant cursor of "runState" is "E5"
    When a job whose newest event is "E2" advances
    Then newestApplied answers "E5" for tenant "project_1"

  @unit @unimplemented
  Scenario: A redelivered job never restores an earlier cursor
    Given a job for "run_1" advanced the tenant cursor to "E1" and failed before acknowledging
    And a job for "run_2" then advanced the tenant cursor to "E2"
    When the job for "run_1" is redelivered
    Then newestApplied answers "E2" for tenant "project_1"

  @unit @unimplemented
  Scenario: A retried job whose first attempt stored but never advanced advances the cursors
    Given a job for "run_1" stored its result and failed before its advance
    When the retry folds nothing new
    Then the cursors are set to the newest event the job delivered

  @unit @unimplemented
  Scenario: Concurrent advances in one tenant leave the larger id
    Given jobs for "run_1" and "run_2" advance the tenant cursor at the same time
    When both have committed
    Then newestApplied answers the larger of the two ids for tenant "project_1"

  @unit @unimplemented
  Scenario: A new projection definition version changes the cache key
    Given the user holds a cached answer of "runs.get"
    When "runState" is deployed with a new definition version
    Then the cached answer's key no longer matches

  @integration @unimplemented
  Scenario: Cursors survive a restart of every process
    Given the user holds a cached answer of "runs.get"
    When the api and the worker restart with nothing applied in between
    Then the cached answer's key still matches

  # Library: freshness

  @unit
  Scenario: An answer a second or more past the hint is fresh
    Given a hint for event "H" accepted in second 100
    When an answer carries an event id from second 101
    Then the answer is fresh

  @unit
  Scenario: An answer in a later second is fresh even when its id sorts below the hint's
    Given the KSUID string order disagrees with time across a 65536 second boundary
    When an answer from the later second is compared with a hint from the earlier one
    Then the answer is fresh

  @unit
  Scenario: An answer from an earlier second than the hint is not fresh
    Given a hint for an event accepted in second 100
    When an answer carries an event id from second 99
    Then the answer is not fresh

  @unit
  Scenario: An answer carrying the hint's own event id is fresh
    Given a hint for event "H"
    When an answer carries the event id "H"
    Then the answer is fresh

  @unit
  Scenario: An answer from another instance inside the hint's second is not fresh
    Given a hint for event "H" written by instance "A" in second 100
    When an answer carries an id from instance "B" in second 100, above or below "H"
    Then the answer is not fresh
    And an answer carrying a later id from instance "A" in second 100 is not fresh either

  @unit
  Scenario: An id that is not a KSUID is never fresh
    When an answer or a hint carries an id that does not parse
    Then the answer is not fresh

  # Framework: the check, in order

  @integration @unimplemented
  Scenario: A caller without the permission is refused even when it holds a cached answer
    Given a user who lost "runs:view" on "project_1" holds a cached answer of "runs.get"
    When the user calls "runs.get"
    Then the call is refused with a forbidden error
    And the read does not run and no cursor is read

  @integration @unimplemented
  Scenario: An unauthenticated caller is refused before any cursor is read
    When an anonymous caller calls "runs.get"
    Then the call is refused with an unauthorised error

  @integration @unimplemented
  Scenario: A read always answers the data in full with its cursor ids
    When the user calls "runs.get"
    Then the answer carries the handler's data and the cursor ids it read

  @integration @unimplemented
  Scenario: The answer carries the cursor ids read before the read ran
    Given the user calls "runs.get"
    And an event for "run_1" is stored and advanced while the handler runs
    When the user calls "runs.get" again
    Then the read runs again and answers its data with the newer cursor id

  @integration @unimplemented
  Scenario: A grant change moves the cache key
    Given the user holds a cached answer of "runs.list"
    When a grant change for the user is projected and the session version is bumped
    And the user calls "runs.list"
    Then the read runs and the answer is cached under a new key

  @integration @unimplemented
  Scenario: A ClickHouse-backed answer behind the hint is asked again until the settle window ends
    Given "runState" is stored in ClickHouse with a settle window of 5 seconds
    And the tab holds a hint for an event the answer's id has not reached
    When the answer arrives and is not fresh
    Then the tab asks again until the answer is fresh or the window has passed
    And a fresh answer ends the asking at once

  @integration @unimplemented
  Scenario: A cache key is bound to its user, its procedure and its input
    Given the user holds a cached answer of "runs.get" for run "run_1"
    Then the same key for run "run_2", for another user or for "runs.list" does not match

  @integration @unimplemented
  Scenario: An unreachable cursor store answers the data with no cursor id
    Given the process store does not answer the cursor read
    When the user calls "runs.get"
    Then the read runs and answers its data
    And the answer carries no cursor id and is never taken as fresh

  @integration @unimplemented
  Scenario: A read served from two projections changes its cache key when either advances
    Given "runs.detail" is served from "runState" and "runResults" keyed by "runId"
    And the user holds a cached answer of "runs.detail"
    When only "runResults" applies an event for that run
    Then the cached answer's key no longer matches

  # Wire

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
