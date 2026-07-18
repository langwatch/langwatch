Feature: CLI daemon mode
  As an AI agent driving the LangWatch CLI many times per turn
  I want a warm, long-lived process to serve my commands
  So that I do not pay node boot, module load, TLS handshake and auth
  resolution on every single invocation, and so that a persistent
  telemetry exporter can stream live progress while a command runs.

  The daemon is an optimisation, never a dependency. Every command must
  behave exactly as it does today when no daemon is reachable.

  Background:
    Given the langwatch CLI is installed
    And the daemon listens on a per-user Unix domain socket

  Rule: The daemon is transparent — the CLI never breaks because of it

    Scenario: No daemon is running
      Given no daemon is listening on the socket
      When I run a command
      Then the command runs in-process exactly as it does today
      And the fallback is only mentioned at debug level

    Scenario: The socket file is stale after a crash
      Given a socket file exists but no process is listening on it
      When I run a command
      Then the stale socket file is removed
      And the command runs in-process without hanging

    Scenario: The daemon dies while serving a command
      Given a daemon is serving my command
      And it has not yet produced enough output to commit
      When the daemon connection drops before the command finishes
      Then the command is retried in-process
      And I see the output exactly once

    Scenario: The user opts out
      Given LANGWATCH_NO_DAEMON is set
      When I run a command
      Then no daemon is contacted and none is spawned

    Scenario: The user opts out persistently
      Given I ran "langwatch config set daemon off"
      When I run a command
      Then no daemon is contacted and none is spawned

  Rule: Only non-interactive invocations are served by the daemon

    Scenario: A human is running the CLI in a terminal
      Given my stdout is a TTY
      When I run a command
      Then the command runs in-process
      And spinners, colours and prompts behave exactly as they do today

    Scenario: An agent pipes the CLI output
      Given my stdout is not a TTY
      And a daemon is running
      When I run "trace search --format json"
      Then the daemon serves the command

    Scenario Outline: Commands that must never be served by the daemon
      Given a daemon is running
      When I run "<command>"
      Then the command runs in-process

      Examples:
        | command          |
        | login            |
        | logout           |
        | config set x y   |
        | open             |
        | claude           |
        | codex            |
        | opencode         |
        | daemon status    |

  Rule: Output and exit codes are faithful

    Scenario: Byte-identical stdout
      Given a daemon is running
      When I run a command that prints JSON with "--format json"
      Then stdout is byte-identical to running the same command in-process

    Scenario: Non-zero exit codes propagate
      Given a daemon is running
      When I run a command that fails
      Then stderr is byte-identical to running it in-process
      And the CLI exits with the same non-zero code

    Scenario: A command that calls process.exit mid-flight
      Given a daemon is running
      When a command exits early because no API key is configured
      Then only the output produced before the exit is emitted
      And the CLI exits with the code passed to process.exit

  Rule: Credentials and warm state are isolated per identity

    Scenario: Two identities never share a daemon
      Given a daemon is warm for identity A
      When I run a command as identity B
      Then identity B does not reach identity A's daemon
      And identity B gets its own daemon on its own socket

    Scenario: The socket is private to the user
      When a daemon starts
      Then its socket is created with 0600 permissions inside a 0700 directory

    Scenario: A daemon rejects a request from a different identity
      Given a daemon is warm for identity A
      When a client presents a fingerprint for identity B
      Then the daemon rejects the handshake
      And the client falls back in-process

  Rule: Version skew is detected at the handshake

    Scenario: A stale daemon from a previous CLI version
      Given a daemon running an older CLI version is listening
      When I run a command with the newer CLI
      Then the handshake is rejected
      And the stale daemon is asked to stop
      And my command runs in-process

  Rule: The daemon holds warm state and never leaks

    Scenario: Warm state survives across commands
      Given a daemon is running
      When I run several commands in a row
      Then the module graph, resolved auth and HTTP connections are reused

    Scenario: The daemon self-exits when idle
      Given a daemon is running with an idle timeout
      When no command arrives before the idle timeout elapses
      Then the daemon exits and removes its socket

    Scenario: Concurrent commands
      Given a daemon is running
      When I fan out several commands from the same working directory at once
      Then they execute concurrently
      And each caller receives only its own output and exit code

    Scenario: Commands run in the caller's working directory
      Given a daemon started from a different directory
      When I run a command that reads a local file
      Then the file is resolved against my working directory, not the daemon's

  Rule: The client can cancel an in-flight command

    Scenario: Ctrl-C during a daemon-served command
      Given the daemon is running my command
      When I interrupt the client
      Then the daemon is told to cancel the request
      And the client exits with code 130
      And no output from the cancelled command is emitted afterwards

    Scenario: A command that hangs
      Given the daemon is running my command
      When the command exceeds the per-request timeout
      Then the request is abandoned with exit code 124
      And its execution window is released for other callers

  Rule: The daemon is managed explicitly

    Scenario: Starting a daemon
      When I run "langwatch daemon start"
      Then a daemon is started in the background
      And its socket path and pid are reported

    Scenario: Inspecting a daemon
      Given a daemon is running
      When I run "langwatch daemon status --json"
      Then I see its pid, uptime, served-request count, in-flight count and CLI version

    Scenario: Stopping a daemon
      Given a daemon is running
      When I run "langwatch daemon stop"
      Then the daemon exits and removes its socket

    Scenario: Auto-spawn on first use
      Given no daemon is running
      And auto-spawn is enabled
      When I run a command
      Then the command runs in-process without waiting for the daemon
      And a daemon is spawned in the background to serve the next command
