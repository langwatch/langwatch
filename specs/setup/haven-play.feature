Feature: haven play, a throwaway PR sandbox
  `haven play [pr]` runs a GitHub PR in a fully isolated, ephemeral
  environment: its own checkout, its own Postgres, ClickHouse, and Redis
  containers and volumes, its own hostnames through the proxy. Quitting the
  attached log view destroys all of it, every time, the opposite contract to
  `haven up`, where quitting detaches and the stack keeps running. Because
  the data is ephemeral by contract, teardown needs no confirmation; the
  data-loss-is-explicit rule (ADR-064) is satisfied by upfront disclosure in
  the help text and the first-run banner. Before anything is checked out, a
  trust gate inspects every commit author on the PR. See ADR-064.

  # Behaviour lives in tools/thuishaven: app/play.go (ref validation, trust
  # gate, sandbox naming, teardown plan, crash records) and cmd/play.go +
  # cmd/table.go (surface). Bound by Go tests (`go test ./...` in
  # tools/thuishaven): app/play_test.go and cmd/table_test.go. The paths that
  # need live gh, docker, or a terminal stay @e2e @unimplemented.

  @unit
  Scenario: A play ref is a PR number or URL
    When the developer runs "haven play 4913" or "haven play" with the PR's GitHub URL
    Then the PR is resolved
    And anything that is neither a PR number nor a PR URL is rejected before anything is created

  @e2e @unimplemented
  Scenario: No argument opens a picker of open PRs
    Given a terminal
    When the developer runs "haven play" with no argument
    Then the repository's open PRs are listed to pick from
    And in agent mode the command fails asking for an explicit PR instead

  @unit
  Scenario: Authors with write access proceed without a prompt
    Given every commit on the PR was authored and committed by people with write access
    When the trust gate runs
    Then play proceeds without asking anything

  @unit
  Scenario: An untrusted author stops play until explicitly confirmed
    Given a commit on the PR whose author does not have write access
    When the trust gate runs in a terminal
    Then play stops and names the untrusted authors before anything is checked out
    And the confirmation defaults to no

  @unit
  Scenario: A commit with no GitHub account is untrusted
    Given a commit whose author maps to no GitHub login
    When the trust gate runs
    Then that author counts as untrusted

  @unit
  Scenario: Agent mode never prompts about trust
    Given an untrusted author on the PR
    When the trust gate runs in agent mode
    Then play fails naming the untrusted authors
    And the error names "--allow-untrusted" as the explicit way to proceed

  @unit
  Scenario: The sandbox can never touch shared data
    Then every play container and volume carries the play prefix in its name
    And none of them can ever equal the shared database volumes
    And a play stack's hostname slug can never equal a "haven pr" checkout's

  @unit
  Scenario: Quitting always destroys everything
    When the developer quits the play log view
    Then processes, hostnames, containers, volumes, the checkout, and the sandbox record are all removed
    And a failing teardown step never stops the steps after it

  @unit
  Scenario: Destruction is disclosed up front, not confirmed at the end
    Then the play command's help says everything is destroyed on exit
    And teardown asks for no confirmation flag

  @unit
  Scenario: A crashed play is discoverable and reapable
    Given play died without tearing down
    Then the sandbox was recorded before anything was created
    And only sandboxes whose owner process is gone are offered for reaping
    And "haven clean" finishes the teardown

  @e2e @unimplemented
  Scenario: A PR runs end to end in the sandbox
    Given a terminal
    When the developer runs "haven play 4913" and passes the trust gate
    Then the PR serves at its own play hostname with its own databases
    And quitting the view tears all of it down
