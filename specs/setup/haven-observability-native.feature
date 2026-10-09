@unit
Feature: The observability stack runs natively on macOS
  The local observability stack stays on by default: an agent debugging its
  worktree reads its own logs, traces and metrics in Grafana. What changes is
  where it runs. On macOS it no longer needs a colima VM: haven starts the
  same stack the grafana/otel-lgtm bundle carries, as host processes from
  Homebrew and pinned Tempo, Alloy and Pyroscope releases haven fetches itself:
  Grafana over Loki, Prometheus, Tempo and Pyroscope,
  with Grafana Alloy (Grafana's OpenTelemetry Collector distribution)
  receiving OTLP and fanning it out.

  It presents the same endpoints on the same ports, with the same datasource
  ids, so nothing upstream of it changes: not the overlay, not the app, not
  the Go services, not the agents' queries and skills.

  # domain/observability_native.go decides and renders the configs,
  # adapters/otelnative runs them, cmd/observability_tier.go picks the tier.

  Rule: The tier is native on macOS, the container is an explicit fallback

    Scenario: A Mac runs the native stack even with a container runtime installed
      Given a Mac with colima and docker installed
      When the stack comes up
      Then the observability stack runs as native processes
      And no colima VM is started for it

    Scenario: A machine with no container runtime uses the native tier
      Given a Mac with no container runtime installed
      When the stack comes up
      Then the observability stack runs as native processes

    Scenario: A machine with a container runtime keeps the bundled stack
      Given a Linux machine with docker installed
      When the stack comes up
      Then the observability stack runs as the LGTM container

    Scenario: The tier can be pinned either way
      When LANGWATCH_HAVEN_OBS_TIER is "container" on a Mac
      Then the LGTM container is used
      And a value that names no tier is reported and the platform default is used

    # Unbound: the switch lives in app/observability.go and cmd/root.go, proven live.
    @unimplemented
    Scenario: Turning observability off still turns it off
      When LANGWATCH_HAVEN_OBS is "0"
      Then no tier is started and nothing is linked unless a stack already answers

  Rule: The colima VM is needed only by a container-only feature

    # domain/container_need.go decides; app/report.go reports it.

    Scenario: A default Mac needs no colima VM
      Given a Mac with native ClickHouse and the native observability tier
      And no stack runs langy in a container
      Then haven needs no colima VM

    Scenario: Each container-only selection names why the VM is needed
      When ClickHouse runs as a container, the LGTM tier is pinned or a stack runs sandboxed langy
      Then haven needs the colima VM and names each of those reasons

    Scenario: Status reports an unneeded VM without probing it
      Given haven needs no colima VM
      When I run haven status
      Then colima is reported as not needed
      And colima is never asked whether the VM is running

    Scenario: Status probes the VM only when a feature needs it
      Given a stack runs sandboxed langy
      When I run haven status
      Then colima reports whether its profile is running, without starting it

  Rule: The native tier presents the same endpoints as the container

    Scenario: One OTLP endpoint, on the same port
      Given the native tier is planned
      Then the collector listens for OTLP over gRPC and HTTP on the container's ports
      And Grafana listens on the container's port, loopback only

    Scenario: Grafana can query every store under the same datasource ids
      Given the native tier is planned
      Then Grafana is provisioned with the loki, prometheus, tempo and pyroscope datasources

    Scenario: Profiles land on the container tier's port
      Given the native tier is planned
      Then Pyroscope listens on loopback on the container tier's profiling port, 4040
      And its gRPC and memberlist ports stay clear of Tempo's
      And it runs the bundle's v2-storage config with every path under the data directory

    Scenario: Metrics carry the worktree label
      Given the native tier is planned
      Then Prometheus promotes langwatch.worktree to a metric label

    Scenario: Every signal reaches its store
      Given the native tier is planned
      Then the collector sends metrics to Prometheus's OTLP receiver
      And logs to Loki's OTLP endpoint and traces to Tempo's OTLP receiver
      And each store listens where the collector sends

    Scenario: A collector whose receiver did not start is down
      Given the collector runs but its OTLP receiver could not bind its port
      When haven probes the collector
      Then the collector counts as down, not ready

  Rule: Tempo and Pyroscope come from pinned releases, not from Homebrew

    Scenario: Haven fetches a pinned, checksummed Tempo
      Given a Mac with no HAVEN_OBS_TEMPO_BIN set
      When the native stack first comes up
      Then haven downloads the pinned Tempo 3.x darwin tarball for its architecture into its home
      And installs the tempo binary only when the tarball matches its pinned sha256
      And renders a Tempo config in the 3.x monolithic schema with every path under its home
      And a later "haven observability down" keeps the binary

    # Unbound: the override is adapter behaviour, proven live.
    @unimplemented
    Scenario: HAVEN_OBS_TEMPO_BIN overrides the download
      Given HAVEN_OBS_TEMPO_BIN names a tempo binary
      When the native stack comes up
      Then haven runs that binary and downloads nothing

    Scenario: Haven fetches a pinned, checksummed Pyroscope
      Given a Mac with no HAVEN_OBS_PYROSCOPE_BIN set
      When the native stack first comes up
      Then haven downloads the pinned Pyroscope 2.x darwin tarball for its architecture into its home
      And installs the pyroscope binary only when the tarball matches its pinned sha256
      And a later "haven observability down" keeps the binary

    # Unbound: the override is adapter behaviour, proven live.
    @unimplemented
    Scenario: HAVEN_OBS_PYROSCOPE_BIN overrides the download
      Given HAVEN_OBS_PYROSCOPE_BIN names a pyroscope binary
      When the native stack comes up
      Then haven runs that binary and downloads nothing

  Rule: A missing binary never fails the stack boot

    Scenario: A missing binary prints its install line
      Given the Loki binary is not installed
      When the stack comes up
      Then haven prints how to install Loki
      And the other components still start

    # Unbound: Ensure's skip-and-warn path is adapter behaviour, proven live.
    @unimplemented
    Scenario: Without a collector the stack boots unobserved
      Given Grafana Alloy is not installed
      When the stack comes up
      Then haven prints how to get Alloy
      And the stack comes up without observability

  Rule: The stack is shared, capped and disposable, exactly as the container was

    # Unbound: reuse is a readiness probe per component, proven live.
    @unimplemented
    Scenario: A second worktree reuses the running stack
      Given the native tier is already running for another worktree
      When a second stack comes up
      Then it exports to the same processes rather than starting a second set

    Scenario: Retention is capped
      Given the native tier is planned
      Then Loki, Tempo and Prometheus are configured with haven's retention window
      And their data lives under haven's home
      # A debugging window, not an archive: the same promise the container
      # made by keeping no volume.

    # Unbound: Stop is pkill plus a directory removal, proven live.
    @unimplemented
    Scenario: Stopping it reclaims what it collected
      When the observability stack is stopped
      Then every native process is stopped
      And the data it collected is discarded

  Rule: The native tier takes the container's ports over and names any conflict

    Scenario: A running observability container is stopped before the native tier starts
      Given haven's own observability container is still running in colima
      When the native tier comes up
      Then haven stops that container, keeping colima running
      And prints one line saying it did

    Scenario: A port held by another process is named in the status
      Given another process listens on a port a native component needs
      When the native tier comes up or its status is read
      Then haven names the component, the port and the process holding it
      And a colima port forward is called out as a container still publishing it

    Scenario: A component's own process is not a conflict
      Given a native component's own process already listens on its port
      When haven checks the component's ports
      Then no conflict is reported
