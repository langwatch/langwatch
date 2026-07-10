@unimplemented
Feature: Langy is observable to the team that builds it
  As a member of the LangWatch team improving Langy
  I want Langy's own activity and its workers' network egress in an internal project
  So that I can see how Langy behaves in the wild and spot suspicious worker behaviour

  # Design: dev/docs/adr/043-langy-event-driven-turns.md (parts 4 and 5)
  # Blocked on PR1 (langy-agent manager telemetry + adapters/egress seam).
  #
  # Mirrors the AI gateway's dual-export (services/aigateway/adapters/
  # customertracebridge): today the opencode OTel plugin exports gen-AI/tool
  # spans ONLY to each user's own project (buildWorkerEnv's OPENCODE_OTLP_*),
  # and the manager emits nothing. This tees Langy's activity to one internal
  # LangWatch project as well, and observes every worker egress call.
  #
  # Egress is FLAG-ONLY here. Enforcement (blocking/killing on a flag) is PR4.

  Background:
    Given the langy-agent manager is configured with an internal observability project
    And a user runs Langy in their own project

  # ===========================================================================
  # Self-observability: agent activity teed to the internal project
  # ===========================================================================

  Scenario: Langy activity still appears in the user's own project
    When the user completes a Langy turn
    Then a trace for that turn appears in the user's own project
    And it is labelled "langy" as before

  Scenario: The same Langy activity also appears in the internal project
    When the user completes a Langy turn
    Then a corresponding trace also appears in the internal observability project
    And the team can see the turn's shape, tools used, model, token counts, and latency

  Scenario: The internal tee does not carry the user's conversation content by default
    When the user completes a Langy turn
    Then the trace in the internal project omits the user's message and answer text
    And it retains the structural and behavioural signal needed to improve Langy

  Scenario: Manager lifecycle activity is visible in the internal project
    When a turn is spawned, runs, and finishes
    Then the internal project shows the spawn, turn lifecycle, and reconcile activity
    And the team can measure spawn latency and stall rate across turns

  Scenario: The tee is disabled cleanly when no internal project is configured
    Given no internal observability project is configured
    When the user completes a Langy turn
    Then activity is exported only to the user's own project
    And nothing is teed anywhere else

  # ===========================================================================
  # Egress monitoring (F2a — monitor and flag only, never block)
  # ===========================================================================

  Scenario: Every outbound worker call is observed
    When a worker makes an outbound network call during a turn
    Then the call is recorded with its destination, size, and encryption state
    And it is attributed to the worker and its conversation

  Scenario: A call to an allowed host over TLS is observed and not flagged
    When a worker calls an allowed host over TLS
    Then the call is recorded
    And it is not flagged as suspicious

  Scenario: A call to an unexpected host is flagged
    When a worker makes an outbound call to a host outside the allowed set
    Then the call is recorded and flagged as suspicious
    And the reason identifies the unexpected destination
    But the call is not blocked

  Scenario: Plaintext egress to an external destination is flagged
    When a worker sends data to an external destination without encryption
    Then the call is flagged as suspicious
    But the call is not blocked

  Scenario: A call toward internal or metadata addresses is flagged
    When a worker attempts to reach a private-range or cloud-metadata address
    Then the call is flagged as suspicious
    And the reason identifies it as an internal or metadata destination
    But the call is not blocked

  Scenario: An exfiltration-shaped upload is flagged
    When a worker uploads an unusually large amount of data to an external host
    Then the call is flagged as suspicious
    But the call is not blocked

  Scenario: Flags surface in the internal project for the team to review
    Given a worker made a flagged egress call during a turn
    When the team reviews Langy activity in the internal project
    Then the flagged call is visible with its reason
    And enforcement of the flag is left to a later change
