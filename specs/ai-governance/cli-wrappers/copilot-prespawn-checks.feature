Feature: `langwatch copilot` warns before spawn when telemetry can silently vanish
  ADR-039 Decisions 8, 9. Two conditions make copilot capture silently
  incomplete, and both must be surfaced BEFORE the tool runs, on BOTH paths
  (the gateway-only preflight never runs for copilot's default ingestion
  path, so these checks are mode-independent):

    - Enterprise-managed Copilot settings can pin an OTel collector
      org-wide; managed values win over injected env vars, so the user's
      telemetry flows to the enterprise collector instead of LangWatch.
    - Copilot CLI versions below 1.0.41 export a different, incomplete
      OTel attribute set.

  Both are warn-and-continue: the user keeps working, support keeps an
  explanation for "copilot shows nothing".

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: an enterprise-managed OTel pin is detected and named

    @unit
    Scenario: A managed OTel pin produces a one-line warning and the run continues
      Given an enterprise managed-settings file pins an OTel collector for copilot
      When the user runs `langwatch copilot` in ingestion mode
      Then the wrapper warns that enterprise policy routes copilot telemetry elsewhere
      And the copilot process is still spawned

    @unit
    Scenario: No managed-settings file produces no warning
      Given no enterprise managed-settings file exists
      When the user runs `langwatch copilot` in ingestion mode
      Then no managed-settings warning is printed

    @unit
    Scenario: The managed-settings warning also fires on the gateway path
      Given an enterprise managed-settings file pins an OTel collector for copilot
      And tool_mode.copilot is saved as "gateway"
      When the user runs `langwatch copilot`
      Then the wrapper warns that enterprise policy routes copilot telemetry elsewhere

  Rule: old copilot versions are warned about, not blocked

    @unit
    Scenario: A copilot older than 1.0.41 gets an upgrade warning and still runs
      Given the installed copilot version is 1.0.30
      When the user runs `langwatch copilot`
      Then the wrapper warns that telemetry is incomplete on this version and suggests upgrading
      And the copilot process is still spawned

    @unit
    Scenario: A copilot at or above 1.0.41 produces no version warning
      Given the installed copilot version is 1.0.41
      When the user runs `langwatch copilot`
      Then no version warning is printed

    @unit
    Scenario: An unparseable copilot version does not block the run
      Given `copilot --version` returns unparseable output
      When the user runs `langwatch copilot`
      Then the copilot process is still spawned
