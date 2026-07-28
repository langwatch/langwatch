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
    Given a same-repo PR
    And every commit on it was authored and committed by people with write access
    When the trust gate runs
    Then play proceeds without asking anything

  # Commit attribution is not authentication. A commit's author and committer are
  # free-text git headers, and the account GitHub shows for them is only a lookup
  # of that attacker-chosen email against verified addresses — and the
  # <id>+<login>@users.noreply.github.com form is publicly derivable. So on a fork,
  # where the PR author controls every commit, attribution buys no trust at all.
  @unit
  Scenario: A fork commit claiming a maintainer's identity is still untrusted
    Given a fork PR whose commit is attributed to someone with write access
    And the commit carries no signature GitHub verified
    When the trust gate runs
    Then that commit counts as untrusted and is named by its sha

  @unit
  Scenario: A fork commit is trusted only when a verified signer has write access
    Given a fork PR whose every commit carries a signature GitHub verified
    And each verified signer has write access
    When the trust gate runs
    Then play proceeds without asking anything

  @unit
  Scenario: One unsigned commit taints a fork PR
    Given a fork PR where some commits are verified and one is not
    When the trust gate runs
    Then play stops, because the unsigned commit is the code that would run

  # GitHub returns at most 250 commits for a PR, oldest first — so a truncated
  # listing omits exactly the head commit that gets checked out and run.
  @unit
  Scenario: A commit listing that hits GitHub's cap fails closed
    Given a PR with at least 250 commits
    When the trust gate reads them
    Then play fails rather than vouching for commits it never saw

  @unit
  Scenario: An untrusted author stops play until explicitly confirmed
    Given a commit on the PR whose author does not have write access
    When the trust gate runs in a terminal
    Then play stops and names the untrusted authors before anything is checked out
    And the confirmation defaults to no

  @unit
  Scenario: A commit with no GitHub account is untrusted
    Given a same-repo PR
    And a commit whose author maps to no GitHub login
    When the trust gate runs
    Then that author counts as untrusted

  # The sandbox isolates the PR's data, not the developer's authority. Its
  # databases, hostnames and checkout are its own and none of the developer's
  # .env files reach it, but the PR's install, migrations, seed and services
  # still run as the developer, in the launching shell's environment — so
  # whatever that shell exports (agent sockets, cloud and registry tokens) is in
  # reach of unreviewed code. A single keystroke is too cheap a way to accept
  # that, so the code of someone without write access takes a second step that
  # cannot be answered by reflex.
  @unit
  Scenario: Untrusted code takes a second, deliberate confirmation
    Given a commit on the PR whose author does not have write access
    And the developer answered yes to the first prompt in a terminal
    When the second step is shown
    Then it says the PR runs as them, with the launching shell's environment
    And play proceeds only when they type the PR number back
    And answering "y" a second time is not enough

  @unit
  Scenario: Declining the first prompt never reaches the second
    Given a commit on the PR whose author does not have write access
    When the developer declines the first prompt
    Then nothing is checked out
    And the second step is never shown

  @unit
  Scenario: Every untrusted path says what the code is given
    Given an untrusted author on the PR
    Then the terminal confirmation, the "--allow-untrusted" warning, and the agent-mode failure all say the PR runs as the developer with the launching shell's environment

  # The repo has a postinstall and a PR controls package scripts, so installing
  # normally would run PR-authored code before any gate on the app code mattered.
  @unit
  Scenario: The sandbox never runs the checkout's package scripts
    Given a play sandbox installing the PR's dependencies
    When the install runs
    Then it passes --ignore-scripts
    And codegen still runs explicitly afterwards

  # This repo copies the developer's own .env files into every new worktree, so a
  # sandbox that took the default would run unreviewed code with their live
  # provider keys and auth secrets — the one thing the banner promises it does not
  # do. The sandbox supplies its own connection settings and needs nothing else.
  @unit
  Scenario: The sandbox never inherits the developer's env files
    Given the developer's checkout holds .env files with real credentials
    When a play sandbox's checkout is created
    Then the repo's checkout hooks do not run for it
    And no .env file the developer owns is left in the sandbox
    And the repo's own tracked example env files are untouched

  @unit
  Scenario: A working PR checkout still gets the env files it has always had
    Given the developer runs "haven pr" rather than "haven play"
    When the worktree is created
    Then the repo's checkout hooks run as normal

  # `go run ./cmd/haven` resolves against the child's working directory, and the
  # sandbox sets that to the PR's own tree, which contains a cmd/haven of its own.
  @unit
  Scenario: The sandbox launcher runs haven's own code, never the PR's
    Given haven is running from source rather than an installed binary
    When it backgrounds the sandbox launcher
    Then it runs haven built from the developer's own checkout
    And the child is told which checkout that is, so anything it spawns agrees

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
