@unit
Feature: Machine settings switch the observability stack and the idle VM
  Two choices hold for every stack on a machine, so they are saved once in
  haven's home: whether the observability stack runs at all, and whether the
  container VM is stopped once nothing uses it. Both are set with
  `haven machine settings` and from the hub's Settings page.

  # domain/machine_settings.go parses them, adapters/fileregistry keeps them,
  # app/machine_settings.go applies them, the daemon tick enforces them.

  Rule: The observability stack can be switched off and on again

    Scenario: Switching observability off stops the stack
      Given the observability stack is running
      When the developer sets observability off
      Then the stack is stopped and its hostname is unrouted
      And the setting is saved for every checkout on the machine

    Scenario: The daemon keeps a switched-off stack down
      Given observability is off
      And something started the observability stack anyway
      When the daemon ticks
      Then the stack is stopped

    Scenario: A stack coming up with observability off gets no collector
      Given observability is off
      When a stack comes up
      Then the observability stack is not started
      And the stack's overlay carries no OTLP endpoint

    Scenario: Switching observability on brings the stack back
      Given observability is off
      When the developer sets observability on
      Then the observability stack is started and routed

  Rule: The container VM stops once nothing has used it for the grace period

    Scenario: An idle VM is stopped after the grace period
      Given runtime auto-stop is on
      And no stack needs a container and no container runs on the VM
      When the VM has been idle for longer than the grace period
      Then the VM is stopped, whoever started it

    Scenario: The VM is not stopped before the grace period ends
      Given runtime auto-stop is on
      And the VM became idle less than the grace period ago
      When the daemon ticks
      Then the VM keeps running

    Scenario: A running container keeps the VM up
      Given runtime auto-stop is on
      And any container runs on the VM
      When the daemon ticks
      Then the VM keeps running and the idle clock restarts

    Scenario: A setting names no known knob
      When the developer sets a setting haven does not have
      Then the command refuses and names the settings there are
