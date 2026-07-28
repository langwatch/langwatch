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

    Scenario: A socket owned by another user is not used
      Given a socket exists at the path my identity resolves to
      But it is owned by another user
      When I run a command
      Then nothing is sent to it — not my arguments, my working directory
      or my forwarded credentials
      And the command runs in-process
      And "langwatch daemon status" reports no daemon running

    Scenario Outline: A socket that is not demonstrably private is not used
      Given a socket exists at the path my identity resolves to
      But <looseness>
      When I run a command
      Then the socket is not connected to
      And the command runs in-process

      Examples:
        | looseness                                        |
        | its directory is writable by other users         |
        | the socket itself is connectable by other users  |
        | it is a symlink rather than a socket             |

    Scenario: The socket directory cannot be made private
      Given the directory my socket would live in is owned by another user
      When I run a command
      Then no daemon is spawned, because its socket could never be private
      And the command runs in-process

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
      Then the request is abandoned with exit code 124 without waiting for it
      And no further output from it reaches me
      But its execution window is still held, because the work is still running
      And the next caller waits rather than having the working directory
      changed underneath the abandoned command

    Scenario: Abandoned work finishes on its own
      Given a command was abandoned at the per-request timeout
      And another caller is waiting for a different working directory
      When the abandoned command finally finishes
      Then it resolved its files against its OWN working directory throughout
      And only then is the waiting caller admitted

    Scenario: Abandoned work never finishes at all
      Given a command was abandoned at the per-request timeout
      When it has still not finished after the abandon grace period
      Then the daemon exits rather than hand its execution window to anyone
      And every command runs in-process, exactly as with no daemon installed

  Rule: The daemon never hands a result computed under the wrong environment

    Scenario: The daemon is stopped while it is still serving
      Given a daemon is serving my command
      When the daemon is asked to stop
      Then it waits for my command to finish before restoring its own
      working directory and environment

    Scenario: An in-flight command outlasts the shutdown grace period
      Given a daemon is serving a command that will not finish
      And none of its output has reached me yet
      When the daemon is asked to stop
      And the shutdown grace period elapses
      Then I am told the daemon declined the command before any exit code is sent
      And the command is retried in-process

    Scenario: An in-flight command outlasts the shutdown grace period after printing
      Given a daemon is serving a command whose output is too large to hold back
      And part of that output has already been printed to me
      When the daemon is asked to stop
      And the shutdown grace period elapses
      Then the command is NOT retried, because that would print the same output twice
      And I am told the output is incomplete and the exit status is not the command's

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
