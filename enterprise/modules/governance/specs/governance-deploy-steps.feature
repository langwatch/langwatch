Feature: Governance's deploy steps
  Governance's own `.withMigrations` steps fill what a release before this one never recorded:
  the coding-assistant billed facts trace folds at ingest (R50: they stay facts, only their
  catch-up seed pages) and the per-charge map the cost drift check compares a day against.
  Both run in the background once no pod of the previous image still writes.

  Rule: The coding-assistant billing seed records every organisation's billed facts once

    @unit
    Scenario: The coding-assistant billing seed is a background step that waits for the old writers
      Given a rollout where pods of the previous image may still edit coding-assistant configs without recording a fact
      Then governance declares "governance:record-coding-assistant-billing" as a background data step
      And the step needs the old writers gone

    @unit
    Scenario: The coding-assistant billing seed pages organisations by cursor and saves each page
      Given three organisations on the install, one of them with an enabled coding-assistant config that bills codex
      When the seed runs with a page of two organisations
      Then the organisations are read a page at a time from organization's id list, never all at once
      And each organisation records one billed fact per coding-assistant source, billed as its configs say
      And the step saves the last organisation of each page it completes

    @unit
    Scenario: The coding-assistant billing seed resumes after the last organisation it saved
      Given a seed that saved its first page before the worker stopped
      When the seed runs again from that checkpoint
      Then it reads organisations after the saved one and records nothing for the first page again

    @unit
    Scenario: Running the coding-assistant billing seed twice leaves the same answers
      Given a seed that has run to the end
      When it runs again from the start
      Then each organisation's billed facts state the same answers as after the first run

    @unit
    Scenario: A dry run of the coding-assistant billing seed records nothing
      When the seed runs as a dry run
      Then it counts the organisations it would record
      And no billed fact is recorded

    @unit
    Scenario: An organisation edited by an old pod is recorded once the old writers are gone
      Given an organisation whose codex config an old pod enabled without recording a fact
      When the seed runs after the old writers are gone
      Then the organisation's codex source is recorded as billed

    @unit
    Scenario: A stopped coding-assistant billing seed ends between organisations and keeps its checkpoint
      Given a seed whose signal is aborted while a page is in progress
      Then it records no further organisation
      And it saves nothing past the last page it completed

    @unit
    Scenario: A failed page read fails the coding-assistant billing seed without saving past it
      Given organization's id list refuses the second page
      When the seed runs
      Then the step fails with that refusal
      And its checkpoint still names the last organisation of the first page

    @unit
    Scenario: An admin's coding-assistant edit stores its billed facts
      Given an installed governance app on a worker
      When an admin saves a coding-assistant tile
      Then one billed fact per assistant kind is stored on the coding-assistant billing pipeline
      And the command is never refused for its shape

  Rule: The cost charge map is replayed over the drift check's restatement window

    @unit
    Scenario: The cost charge replay is a background replay of the charge lane that waits for the old writers
      Given a rollout where pods of the previous image still append pulled usage without a charge map
      Then governance declares "governance:replay-cost-charges" replaying the "governanceCostCharges" lane of its pulled usage pipeline
      And the step needs the old writers gone

    @unit
    Scenario: The cost charge replay starts thirty days before the deploy
      Given a deploy on 8 October 2026 at 09:30 UTC
      When the cost charge replay runs for the first time
      Then it replays pulled usage stored since 8 September 2026 at 09:30 UTC
      And a day the settling window can still restate has its charges filled before the drift check reads it

    @integration @unimplemented
    Scenario: A day of pulled usage recorded before the deploy compares equal after the replay
      Given ClickHouse holding pulled usage events of one day appended before the charge map existed
      And no charge row for that day
      When the cost charge replay runs over the real replay engine
      Then the day's charges are filled from the stored events
      And a second run leaves the same charges
