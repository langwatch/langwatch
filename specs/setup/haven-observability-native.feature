@unit
Feature: The observability stack runs without a container runtime
  Everything else in the local stack can already run with no container
  runtime installed: LANGWATCH_HAVEN_CH=0 points ClickHouse at a native
  server, Postgres and Redis are brew services, and the Go and Node lanes are
  just processes. The observability stack was the last thing holding a
  colima VM open — one `grafana/otel-lgtm` container — so a developer who
  wanted a docker-free machine had to give up logs, metrics and Grafana
  entirely (LANGWATCH_HAVEN_OBS=0) to get one.

  The native tier is the same stack from Homebrew: Grafana over Loki and
  Prometheus, with Grafana Alloy receiving OTLP and fanning it out. It
  presents the same endpoints on the same ports, so nothing upstream of it
  changes — not the overlay, not the app, not the Go services, not browser
  telemetry.

  Traces are the one thing it cannot carry. Grafana publishes no macOS build
  of Tempo, it is in no Homebrew tap, and its module path blocks `go install`
  — so the native tier stores logs and metrics, and says so rather than
  letting spans vanish into a stack that looks complete.

  # domain/observabilitytier.go decides and renders the configs,
  # adapters/otelnative runs them, cmd/root.go picks the tier.

  Rule: The tier is chosen by what the machine can actually do

    Scenario: A machine with a container runtime keeps the bundled stack
      Given colima and docker are installed
      When the stack comes up
      Then the observability stack runs as the LGTM container
      And traces are collected

    Scenario: A machine with no container runtime uses the native tier
      Given no container runtime is installed
      When the stack comes up
      Then the observability stack runs as native processes
      And one line says traces are not collected on this tier

    Scenario: The tier can be pinned either way
      When LANGWATCH_HAVEN_OBS_TIER is "native" on a machine that has docker
      Then the native tier is used anyway
      And pinning "container" on a machine with no runtime fails saying why

    Scenario: Turning observability off still turns it off
      When LANGWATCH_HAVEN_OBS is "0"
      Then no tier is selected and nothing is started

  Rule: The native tier presents the same endpoints as the container

    Scenario: One OTLP endpoint, on the same port
      Given the native tier is running
      Then OTLP over HTTP and gRPC answer on the ports the container used
      And the worktree overlay is byte-for-byte what it was
      # The app, the Go services and browser telemetry all export to one
      # endpoint. A tier that moved it would be a tier that broke them.

    Scenario: Grafana can query both stores
      Given the native tier is running
      Then Grafana is provisioned with a Loki datasource and a Prometheus one
      And neither is named Tempo, because there is nothing behind it

    Scenario: Profiling is off, not broken
      Given the native tier is running
      Then no Pyroscope endpoint is published
      And the overlay names none, so nothing profiles into a void

  Rule: Traces are refused honestly, not dropped quietly

    Scenario: Spans are accepted and discarded
      Given the native tier is running
      When a service exports a span
      Then the export succeeds rather than erroring the exporter
      And the span is not stored

    Scenario: The developer is told once, where they will see it
      When the native tier starts
      Then it says logs and metrics are collected and traces are not
      And it names what would restore them

  Rule: What the tier needs is something haven install can offer

    Scenario: The native tier's formulae are a prerequisite haven knows
      When the developer runs "haven install --list"
      Then the native observability stack is listed as an optional prerequisite
      And installing it installs Grafana, Loki, Prometheus and Alloy

  Rule: The stack is shared, capped and disposable, exactly as the container was

    Scenario: A second worktree reuses the running stack
      Given the native tier is already running for another worktree
      When a second stack comes up
      Then it exports to the same processes rather than starting a second set

    Scenario: Retention is capped
      Given the native tier is running
      Then Loki and Prometheus are configured with haven's retention window
      # A debugging window, not an archive — the same promise the container
      # made by keeping no volume.

    Scenario: Stopping it reclaims what it collected
      When the observability stack is stopped
      Then every native process is stopped
      And the data it collected is discarded
