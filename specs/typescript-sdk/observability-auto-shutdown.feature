Feature: The observability SDK flushes on exit without terminating its host
  As a service owner who installed the LangWatch SDK for observability
  I want the SDK to flush its telemetry when my process is asked to stop
  So that I keep my last spans without the SDK deciding when my process dies

  # setupObservability() registers handlers for `beforeExit`, `SIGINT` and `SIGTERM`
  # so that a program that is about to stop still exports what it has buffered.
  #
  # Node runs *every* listener registered for a termination signal. The SDK used to
  # call `process.exit(0)` as soon as its own flush finished, which ended the process
  # out from under every other listener: a host draining a queue, finishing in-flight
  # database writes or closing connections lost the rest of its shutdown a second or
  # two into it. Observability tooling must never terminate its host.
  #
  # The rule is therefore: flush, then hand the decision back. The SDK exits nothing
  # that anybody else could be shutting down.
  #
  # That leaves one case worth protecting. A signal with at least one listener no
  # longer performs Node's default action, so a one-shot script whose ONLY listener
  # is the SDK's would be left running by a bare "flush and do nothing" — the SDK
  # would have silently neutered Ctrl+C. So after flushing the SDK removes its own
  # listeners and, only if that leaves the signal with no listeners at all, re-raises
  # the same signal at itself. Node then applies the default action and the process
  # ends exactly as it would have if the SDK had never been loaded, reporting the
  # signal rather than the success status `process.exit(0)` used to fake.

  Background:
    Given an application that has called setupObservability with default options

  Rule: The SDK never terminates a host that is shutting itself down

    @unit
    Scenario: A host with its own SIGTERM handler keeps control of its shutdown
      Given the application registered its own SIGTERM handler
      When the process receives SIGTERM
      Then the SDK flushes its pending telemetry
      And the SDK does not exit the process
      And the SDK does not re-raise the signal

    @unit
    Scenario: A host drain that outlives the flush is not cut short
      Given the application registered its own SIGTERM handler that drains for longer than the flush takes
      When the process receives SIGTERM
      Then the drain still runs to completion after the SDK has finished flushing
      And the SDK does not exit the process

    @unit
    Scenario: An export failure during the flush still leaves the host alone
      Given the application registered its own SIGTERM handler
      And the telemetry flush fails
      When the process receives SIGTERM
      Then the failure is reported to the SDK logger
      And the SDK does not exit the process

    @unit
    Scenario: A second signal during the flush does not start a second shutdown
      Given the application registered its own SIGTERM handler
      When the process receives SIGTERM twice
      Then the SDK flushes its pending telemetry once

  Rule: A program whose only shutdown listener is the SDK still stops

    @unit
    Scenario: A one-shot script ends on the signal once the flush is done
      Given the application registered no signal handlers of its own
      When the process receives SIGTERM
      Then the SDK flushes its pending telemetry
      And the SDK re-raises SIGTERM at the process so the default action applies
      And the SDK does not exit the process with a success status

    @unit
    Scenario: Ctrl+C on a script with no other handler still stops the script
      Given the application registered no signal handlers of its own
      When the process receives SIGINT
      Then the SDK re-raises SIGINT at the process so the default action applies

    @unit
    Scenario: A flush that fails does not leave a one-shot script running
      Given the application registered no signal handlers of its own
      And the telemetry flush fails
      When the process receives SIGTERM
      Then the SDK re-raises SIGTERM at the process so the default action applies

  Rule: Draining the event loop still flushes, and only flushes

    @unit
    Scenario: Telemetry is flushed when the event loop drains
      When the event loop drains and the process is about to exit
      Then the SDK flushes its pending telemetry
      And the SDK does not exit the process
      And the SDK does not re-raise any signal

  Rule: The host can opt out of the handlers, or opt in to being exited

    @unit
    Scenario: Disabling auto shutdown registers no handlers at all
      Given the application set advanced.disableAutoShutdown
      When the SDK is set up
      Then the SDK registers no exit or signal handlers
      And the application is responsible for calling shutdown itself

    @unit
    Scenario: A host that relied on being exited can ask for it explicitly
      Given the application set advanced.UNSAFE_exitProcessAfterAutoShutdown
      And the application registered its own SIGTERM handler
      When the process receives SIGTERM
      Then the SDK exits the process as soon as its own flush finishes
