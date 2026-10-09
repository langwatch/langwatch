Feature: haven's ClickHouse runs natively on macOS
  The shared ClickHouse was the main reason a Mac kept a colima VM running.
  On macOS haven now runs the official upstream `clickhouse` binary as a host
  process instead: one shared server per machine, a database per worktree,
  the same tuning and memory ceiling as the container. The container stays as
  the fallback (HAVEN_CH_RUNTIME=container) and the default off macOS.

  The native server starts fresh in its own data directory. It never opens the
  container's volume, so a stack's ClickHouse data is not carried over: the
  stack re-runs its migrations on the next `haven up`.

  # domain/clickhousenative.go decides and renders, adapters/clickhousenative
  # runs the server, cmd/root.go picks the runtime.

  Rule: The runtime is chosen once, by what was stated and what the machine is

    @unit
    Scenario: A Mac with nothing stated runs ClickHouse natively
      Given HAVEN_CH_RUNTIME is unset
      And the machine is macOS on a CPU haven has a pinned binary for
      When haven composes its ClickHouse
      Then it runs the native server

    @unit
    Scenario: A stated container runtime keeps the container
      Given HAVEN_CH_RUNTIME is "container"
      When haven composes its ClickHouse
      Then it runs the shared ClickHouse container

    @unit
    Scenario: Other systems keep the container by default
      Given HAVEN_CH_RUNTIME is unset
      And the machine is Linux
      When haven composes its ClickHouse
      Then it runs the shared ClickHouse container

    @unit
    Scenario: Native stated where no binary is pinned is refused
      Given HAVEN_CH_RUNTIME is "native"
      And the machine is Linux
      When haven composes its ClickHouse
      Then haven reports that no native ClickHouse is pinned for this machine

  Rule: The binary is pinned by version and checksum

    @unit
    Scenario: Each supported Mac CPU has one pinned download with its digest
      When haven looks up the native ClickHouse for macOS on arm64 or amd64
      Then it gets the upstream LTS release asset for that CPU
      And a sha256 digest the download must match before it is used

  Rule: The native server is configured like the container

    @unit
    Scenario: The native server listens on loopback only, in haven's home
      When haven renders the native server configuration
      Then the server listens on 127.0.0.1 on the stack-independent HTTP port
      And its data, temporary files, access storage and logs live under haven's home
      And it opens no native-protocol, MySQL or PostgreSQL wire port

    @unit
    Scenario: The native server keeps the container's access rules and timezone
      When haven renders the native server configuration
      Then system tables need a grant, as in the container's stock configuration
      And SQL-created users and roles persist in a local access directory
      And the server timezone is UTC

    @unit
    Scenario: The native default user has the container's local credentials
      When haven renders the native users configuration
      Then the default user signs in with the local password, from loopback only

  Rule: LangWatchQL reaches Postgres on the host's loopback

    @unit
    Scenario: A native ClickHouse reaches Postgres on 127.0.0.1
      Given the stack's ClickHouse runs natively
      When haven builds the stack's environment
      Then LWQL_POSTGRES_HOST is 127.0.0.1

    @unit
    Scenario: A stack provisioned in colima keeps the VM's host route
      Given a stack recorded before the runtime was stored on it
      When haven builds the stack's environment
      Then LWQL_POSTGRES_HOST is host.lima.internal

  @integration @unimplemented
  Scenario: A fresh native server serves a seeded stack
    Given no native ClickHouse has run on this machine
    When a stack comes up with seeding
    Then haven downloads and verifies the pinned binary
    And the stack's migrations run on its own database
    And an ingested trace is readable through analytics
    And a LangWatchQL query joins a Postgres table through the named collection

  Rule: Status reports the native server's memory

    @unit
    Scenario: Native status reads the server's resident memory from the process
      Given the native ClickHouse server is running
      When haven reports its status
      Then it shows the server process's resident memory
      And names the max_server_memory_usage cap it is measured against
