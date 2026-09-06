Feature: `langwatch copilot-app connect` provisions app capture
  ADR-039 §Extension. The standalone GitHub Copilot app is a long-running GUI,
  not a per-invocation CLI, so there is nothing to wrap. Instead the user
  connects it once:

    - LangWatch mints a personal ingest key for sourceType "copilot_app"
      (reusing the shared ingest-key primitive), distinct from the CLI's
      "copilot_cli" key so the two surfaces are separated by source.
    - A login agent is installed that owns the app's launch and injects the
      direct-OTLP capture env (see copilot-app-launch-agent.feature).

  Reconnect is idempotent: re-running `connect` rotates the key and re-points
  the agent, and never installs a second agent. Teardown is `langwatch
  logout`.

  Pairs with:
    - specs/ai-governance/cli-wrappers/copilot-app-launch-agent.feature
    - specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
    - specs/ai-governance/ingestion-sources/copilot-app-otlp.feature

  Background:
    Given the user has completed `langwatch login --device` for org "acme"
    And the GitHub Copilot app is installed

  Rule: connect mints a copilot_app ingest key distinct from the CLI key

    @integration
    Scenario: Connecting the app mints a personal ingest key for sourceType copilot_app
      When the user runs `langwatch copilot-app connect`
      Then a personal ingest key of sourceType "copilot_app" is minted for org "acme"

    @integration @unimplemented
    Scenario: The app key is separate from an existing copilot_cli key
      Given the user already has a personal ingest key of sourceType "copilot_cli"
      When the user runs `langwatch copilot-app connect`
      Then the minted "copilot_app" key is a different key from the "copilot_cli" key

    @unit
    Scenario: Connect refuses when the app is not installed
      Given the GitHub Copilot app is not installed
      When the user runs `langwatch copilot-app connect`
      Then the command fails with a loud message that the app was not found
      And no ingest key is minted

  Rule: connect installs the login agent that captures the app

    @integration
    Scenario: Connecting installs a login agent for the current operating system
      When the user runs `langwatch copilot-app connect`
      Then a user-level login agent for capturing the app is installed

    @integration
    Scenario: Connect confirms where the captured traces will appear
      When the user runs `langwatch copilot-app connect`
      Then the command reports the project the app's usage will be tracked into

  Rule: reconnect is idempotent

    @integration @unimplemented
    Scenario: Re-running connect rotates the key and re-points the agent
      Given the user has already connected the app
      When the user runs `langwatch copilot-app connect` again
      Then the previous "copilot_app" key is revoked
      And the login agent is re-pointed at the new key

    @integration
    Scenario: Re-running connect never installs a second agent
      Given the user has already connected the app
      When the user runs `langwatch copilot-app connect` again
      Then exactly one capture login agent exists

  Rule: the connection survives across restarts

    @e2e @unimplemented
    Scenario: After reconnecting, a new app turn is tracked into LangWatch
      Given the user has connected the app
      When the user completes a turn in the Copilot app
      Then the turn appears in the connected project as a "copilot_app" trace
