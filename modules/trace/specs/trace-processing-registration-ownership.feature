Feature: Trace processing pipeline registration ownership

  Trace has two registration shapes over one pipeline name, `trace_processing`:
  the producer-only definition, which stages commands and refuses everything the
  consumer side owns, and the complete definition with the real ClickHouse
  stores, the fold projections and every subscriber.

  One runtime holds one registration per name. So a process composes exactly one
  of them and says which: the interactive api produces, and the background worker
  drains. The worker composes Trace's read graph before its install phase runs,
  so it registers nothing while composing and resolves its senders off its own
  registration at the first send.

  This matters because the two definitions are not interchangeable. A
  producer-only registration that won the name on the worker left every recorded
  span draining into stand-ins that reject by design, and nothing refused at
  boot - the process looked healthy and stored nothing.

  Background:
    Given a process runtime that registers event pipelines

  @unit
  Scenario: A second registration of one pipeline name refuses at boot
    Given a pipeline name already registered on this runtime
    When a second definition of that name is registered
    Then the registration is refused

  @unit
  Scenario: The refusal names what each of the two registrations carries
    Given a pipeline name already registered on this runtime
    When a second definition of that name is registered
    Then the refusal names the pipeline
    And it describes what the already-registered definition carries
    And it describes what the refused definition carries

  @unit
  Scenario: A refused registration leaves the first one intact
    Given a pipeline name already registered on this runtime
    When a second definition of that name is refused
    Then the runtime still holds exactly the first registration

  @unit
  Scenario: Two differently named pipelines both register
    Given a pipeline registered on this runtime
    When a pipeline with a different name is registered
    Then both registrations are held

  # Retired 2026-09-25: trace registers through its own withEventing; the kernel registers once per role.
  Scenario: The producing process registers the pipeline it stages commands on
    Given a process in Trace's producer role
    When it composes Trace
    Then it registers the trace_processing pipeline exactly once

  # Retired 2026-09-25: trace registers through its own withEventing; the kernel registers once per role.
  Scenario: The draining process registers no second pipeline
    Given a process that drains the trace_processing pipeline
    When it composes Trace before its install phase
    Then it registers no pipeline

  @unit
  Scenario: A command sent before the pipeline is connected names the missing command
    Given Trace has been composed but trace_processing has not connected its senders
    When a trace command is sent
    Then the command is refused by name, naming the trace_processing command

  @unit
  Scenario: Trace's commands reach the senders the process connected
    Given trace_processing has connected its senders to Trace
    When Trace sends its annotation and rename commands
    Then every one of them reaches the connected sender of the same name

  # Retired 2026-09-25: trace registers through its own withEventing; the kernel registers once per role.
  Scenario: A command the process's registration does not declare refuses by name
    Given a process that drains the trace_processing pipeline
    And its registration declares no rename command
    When the rename command is sent
    Then the capability is refused by name
