Feature: Continuous profiling — where the CPU actually went

  Traces say which call was slow. Metrics say the process was busy. Neither
  says which function burned the CPU, so the last step of every performance
  investigation is a guess, or a laptop reproduction that never quite matches
  production.

  Continuous profiling closes that gap: every platform process samples its own
  CPU and heap on a timer and pushes the samples to Pyroscope, where a flame
  graph for any window is a query rather than a repro. The profiles sit next to
  the traces, logs and metrics the same process already emits, tagged with the
  same service name and environment, so an investigation moves between the four
  signals without leaving Grafana.

  This is platform-internal telemetry about LangWatch itself, exactly like the
  Tempo traces and the Loki logs. It is never customer data.

  Rule: Profiling is opt-in and silent when unconfigured

    Profiles are a push, and a push needs somewhere to push to. A process with
    nowhere configured must not attempt one, must not pay for the profiler's
    sampling overhead, and must not load the profiler's native dependencies at
    boot — the same bargain the OTLP exporters already strike, for the same
    reason: the common self-hosted case configures none of this.

    @unit
    Scenario: A process with no profiling endpoint does not profile
      Given a deployment that has not been told where to send profiles
      When the process boots
      Then it gathers no profiles and sends nothing
      And it pays no startup or memory cost for the profiler

    @unit
    Scenario: A process with a profiling endpoint profiles itself
      Given a deployment that has been told where to send profiles
      When the process has been running for a while
      Then profiles of its own CPU and memory arrive at that destination
      And they keep arriving for as long as it runs

    @unit
    Scenario: A profiler that cannot start does not stop the process
      Given a deployment that has been told where to send profiles
      When profiling cannot start on this machine
      Then the process keeps serving traffic without profiles
      And an operator can tell from the logs why they are missing

  Rule: A profile is findable by the same identity as a trace

    A flame graph nobody can attribute is a curiosity. The whole value is
    answering "which service, which deployment, which worktree" — so profiles
    carry the identity the other three signals already carry, or they cannot be
    correlated with them.

    @unit
    Scenario: Profiles carry the service identity
      Given a process configured to profile
      When it pushes a profile
      Then the profile is labelled with the service name the process reports to OpenTelemetry
      And the profile is labelled with the deployment environment

    @unit
    Scenario: Profiles carry the worktree label in local development
      Given a local worktree exporting telemetry to the shared stack
      When one of its processes pushes a profile
      Then the profile is labelled with that worktree
      And a developer can filter the flame graph to their own worktree

  Rule: The local stack serves profiles without extra setup

    The shared LGTM stack already runs Pyroscope and already provisions a
    Pyroscope datasource. A developer should get flame graphs from the same
    "make haven up" that gives them traces, without learning a new address.

    @unit
    Scenario: The observability stack exposes its profiling endpoint
      When haven starts the shared observability stack
      Then the stack's profiling endpoint is reachable on loopback
      And it is bound to loopback only, like every other port the stack publishes

    @unit
    Scenario: A worktree is told where to push profiles
      Given the shared observability stack is running
      When haven writes a worktree's environment overlay
      Then the overlay names the profiling endpoint
      And a process started from that overlay profiles itself without further configuration

    @unit
    Scenario: A worktree without the observability stack is told nothing
      Given the shared observability stack is not running
      When haven writes a worktree's environment overlay
      Then the overlay names no profiling endpoint
      And no process started from it attempts to push a profile
