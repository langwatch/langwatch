Feature: the login agent owns the Copilot app launch and injects capture env
  ADR-039 §Extension. Copilot enables OTLP export only through environment
  variables, and the auth header that carries the ingest key is env-only —
  no config file can supply it (spike-verified: the user settings file does
  not enable telemetry, and managed-settings' header is documented env-only).
  A GUI launched from the Dock inherits no shell. So a user-level login agent
  owns the app's launch and sets the capture env on the app process:

    - COPILOT_OTEL_ENABLED — turn on the native OTel export.
    - OTEL_EXPORTER_OTLP_ENDPOINT — the LangWatch /api/otel base (the app
      appends /v1/traces, so it posts to /api/otel/v1/traces).
    - OTEL_EXPORTER_OTLP_HEADERS — Authorization: Bearer <personal ingest key>.
    - content capture — on by default.

  The app then pushes gen_ai.* OTLP straight to LangWatch. The app's spawned
  runtime engine inherits this env (spike-verified against build 1.0.71).

  Capture-everything default (ADR-039 constraint): content capture is on by
  default; an explicit user opt-out is respected with a loud tokens-only
  notice; never silently tokens-only — parity with `langwatch copilot` (CLI).

  Per-OS host: launchd (macOS), systemd --user (Linux), Task Scheduler
  (Windows). One long-lived process; restarts on login; removed by logout.

  Pairs with:
    - specs/ai-governance/cli-wrappers/copilot-app-connect.feature
    - specs/ai-governance/cli-wrappers/copilot-env-injection.feature
    - specs/ai-governance/cli-wrappers/logout.feature

  Background:
    Given the user has connected the Copilot app for org "acme"
    And the user has a personal ingest key of sourceType "copilot_app"

  Rule: the agent injects the direct-OTLP capture env onto the app

    @unit @unimplemented
    Scenario: The app process is pointed at the LangWatch OTLP endpoint
      When the login agent launches the Copilot app
      Then the app env sets OTEL_EXPORTER_OTLP_ENDPOINT to the LangWatch /api/otel base
      And the app env sets COPILOT_OTEL_ENABLED

    @unit @unimplemented
    Scenario: The app process carries the ingest key as a bearer auth header
      When the login agent launches the Copilot app
      Then the app env sets OTEL_EXPORTER_OTLP_HEADERS to an Authorization Bearer of the ingest key

    @unit @unimplemented
    Scenario: Content capture is enabled by default
      When the login agent launches the Copilot app
      Then the app env enables message-content capture

    @unit @unimplemented
    Scenario: An explicit opt-out yields a loud tokens-only notice, never silent
      Given the user opted out of content capture for the app
      When the login agent launches the Copilot app
      Then message-content capture is not enabled
      And the user is loudly notified that capture is tokens-only

  Rule: the agent uses the right host for each operating system

    @unit @unimplemented
    Scenario: On macOS the agent is a launchd login item
      Given the operating system is macOS
      When the capture login agent is installed
      Then the agent is registered as a launchd login item

    @unit @unimplemented
    Scenario: On Linux the agent is a systemd --user unit
      Given the operating system is Linux
      When the capture login agent is installed
      Then the agent is registered as a systemd --user unit

    @unit @unimplemented
    Scenario: On Windows the agent is a Task Scheduler logon task
      Given the operating system is Windows
      When the capture login agent is installed
      Then the agent is registered as a Task Scheduler logon task

  Rule: capture survives the app lifecycle

    @integration @unimplemented
    Scenario: The app inherits the capture env into its spawned runtime engine
      When the login agent launches the Copilot app with the capture env
      Then the app's spawned runtime engine carries the same OTLP endpoint and auth header

    @integration @unimplemented
    Scenario: Capture resumes after a reboot without user action
      Given the capture login agent is installed
      When the user logs in again after a reboot
      Then the agent is running and the app launches with the capture env

  Rule: logout tears the capture down

    @integration @unimplemented
    Scenario: Logout removes the capture login agent
      Given the capture login agent is installed
      When the user runs `langwatch logout`
      Then the capture login agent is removed

    @integration @unimplemented
    Scenario: Logout revokes the copilot_app ingest key
      When the user runs `langwatch logout`
      Then the personal ingest key of sourceType "copilot_app" is revoked
