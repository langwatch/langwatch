Feature: A process says when it is ready to take traffic
  As an operator running LangWatch processes in Kubernetes
  I want liveness and readiness answered on separate paths
  So that a booting or store-less process is kept out of the Service without being restarted

  # Ruled 2026-10-06 (Q154(2)): a process is not ready until every installed
  # module has booted and its stores answer; /readyz answers 503 until then,
  # while liveness (/healthz) answers 200 once the process is up. /healthz
  # never waits on boot (specs/server/worker-liveness-probe.feature).
  #
  # Readiness latches once it has passed: a store that stops answering later
  # does not turn it back (default taken, held for Alex). A draining process
  # is no longer ready, so the Service stops sending it new work.

  Rule: Liveness never waits on boot

    @unit
    Scenario: Liveness answers while the modules are still booting
      Given a process whose module boot is held
      When the kubelet asks /healthz and /readyz
      Then /healthz answers 200
      And /readyz answers 503

  Rule: Ready means booted and every opened store answered

    @unit
    Scenario: Readiness turns 200 once boot finished and the stores answer
      Given a process whose modules booted and whose opened stores answer
      When the process serves
      Then /readyz answers 200

    @unit
    Scenario: A store that does not answer keeps the process unready
      Given a process whose modules booted but one opened store does not answer
      When the kubelet asks /readyz
      Then /readyz answers 503
      And it answers 200 once that store answers

    @unit
    Scenario: A failed boot never turns ready
      Given a process whose module boot fails
      When the kubelet asks /readyz
      Then /readyz answers 503
      And /healthz still answers 200 until the process exits

    @unit
    Scenario: A draining process is no longer ready
      Given a ready process
      When it begins to shut down
      Then /readyz answers 503

  Rule: The stores a process opened are the ones asked

    @integration
    Scenario: Each opened store answers one cheap check
      Given a process that opened its PostgreSQL and Redis clients
      When readiness asks the stores
      Then each opened client answers one cheap query
      And a store the process never opened is not asked

    @unit
    Scenario: A store that cannot be reached is named in the refusal
      Given a process whose opened PostgreSQL cannot be reached
      When readiness asks the stores
      Then the check fails naming the prisma store
