@unit
Feature: Machine settings switch the observability stack and the idle VM
  These choices hold for every stack on a machine, so they are saved once in
  haven's home: whether the observability stack runs at all, whether the
  container VM may run at all, and whether it is stopped once nothing uses it. Both are set with
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

  Rule: The VM can be switched off so nothing ever runs in a container

    Scenario: With the VM off, ClickHouse and observability run natively
      Given the vm setting is off
      When a stack comes up, whatever HAVEN_CH_RUNTIME or the observability tier pin says
      Then ClickHouse runs as the native server and observability as native processes

    Scenario: With the VM off, a machine with no native ClickHouse is told what to install
      Given the vm setting is off
      And haven pins no native ClickHouse for this machine
      When a stack comes up
      Then haven names what to install and stops instead of starting the VM

    Scenario: With the VM off, nothing starts the VM
      Given the vm setting is off
      When any path asks the container runtime to start
      Then it refuses with one line naming the setting

    Scenario: With the VM off, sandboxed Langy is refused, never run unsandboxed
      Given the vm setting is off
      And Langy resolves to a container tier
      When a stack comes up
      Then Langy is left out with one line naming the setting
      And it is never moved to the unsandboxed host tier

    Scenario: With the VM off, haven pr --throwaway is refused
      Given the vm setting is off
      When the developer asks for a throwaway sandbox
      Then haven refuses with one line naming the setting

    Scenario: With the VM off, a VM haven started is stopped once nothing runs on it
      Given the vm setting is off
      And haven started the VM
      When no container runs on it
      Then the VM is stopped, and a VM the developer started is left alone

    Scenario: Status shows the VM switched off
      Given the vm setting is off
      When the developer runs haven status
      Then the VM row says it is off by the machine setting, without probing it

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
