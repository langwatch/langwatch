Feature: A worktree's own home page at <slug>.langwatch.localhost
  The hub answers "what runs on this machine"; a stack's home answers "where is
  everything for this worktree, is it healthy, and how do I sign in". It lists
  every surface of the stack with live status, the stack's facts, its recent
  errors, the credentials a developer needs, and the actions the hub already
  offers. The haven daemon serves it, so it answers when the stack is down.

  # Behaviour: tools/thuishaven/adapters/dashboard (routing by Host, /api/stacks/{slug}),
  # UI: apps/haven-web (StackHome). Design: packages/design-system-internal/README.md.
  # ADR-160. @unit scenarios bind to Go tests via `// @scenario`
  # (tools/thuishaven/adapters/dashboard/stackhome_test.go); @integration to
  # apps/haven-web component tests.

  Background:
    Given the haven daemon is running
    And a worktree with the slug "feat-x" has a registered stack

  @unit
  Scenario: The bare stack hostname routes to the stack home
    When "feat-x.langwatch.localhost" is requested
    Then the daemon serves the console bundle
    And the console shows the stack home for "feat-x"

  @unit
  Scenario: The stack home's data comes from one endpoint
    When "/api/stacks/feat-x" is requested
    Then the response carries the stack's facts, every surface with its URL, port and status, its recent errors and its dev credentials

  @unit
  Scenario: An unknown slug is a not-found, not a blank page
    When "nope.langwatch.localhost" is requested
    Then the stack home says no stack is registered for "nope"
    And it links to the hub

  @integration
  Scenario: Every surface of the stack is listed with live status
    When I open the stack home
    Then I see the app, the API, the worker, the Go services, the IdP simulator, the mail sink, the design system and the mail room
    And each shows live, starting, down or not selected beside its hostname and port
    And a surface the worktree did not select says how to turn it on

  @integration
  Scenario: The home answers while the stack is down
    Given the stack's launcher is not running
    When I open the stack home
    Then every surface shows down
    And a start action is offered

  @integration
  Scenario: Restarting from the home asks for a confirming second click
    When I press restart on the stack home
    Then nothing happens until I press it again within three seconds
    And the stack restarts and its surfaces show starting then live

  @integration
  Scenario: Recent errors link into the logs
    Given the api lane logged errors in the last hour
    When I open the stack home
    Then I see the latest errors per lane, newest first
    And each links to the hub's log view filtered to this stack and lane

  @integration
  Scenario: Dev credentials are shown without printing secrets
    When I open the stack home
    Then I see the seeded login, this stack's mail address and the IdP simulator's tenants
    And the local API key is masked with a copy button

  @integration
  Scenario: Stack facts
    When I open the stack home
    Then I see the branch, worktree path, layout, uptime, memory, and the Postgres, ClickHouse and Redis databases it uses

  @unit
  Scenario: A Go build without the bundle still answers
    Given the console bundle was not built
    When "feat-x.langwatch.localhost" is requested
    Then the daemon answers with a page naming the command that builds it
