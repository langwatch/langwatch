Feature: Gateway telemetry resilience

  # Verified in the Go gateway via unit tests in pkg/otelsetup/.
  # Out of scope for the TS parity check.

  The gateway runs on the customer hot path and ships OTel spans to an
  internal collector. The collector and its downstream backend (Tempo)
  are *internal observability* — gateway availability must NEVER depend
  on their health. Any failure mode in the trace pipeline that takes
  the gateway down is a sev-1 bug.

  Rule: Trace export errors never crash the process

    # Regression for the 2026-05-18 incident: startupErrorHandler
    # captured otelapi.GetErrorHandler() as its delegate, then registered
    # itself as the global. Because GetErrorHandler() returns the singleton
    # *ErrDelegator wrapper (not the previous concrete handler), the
    # delegator pointed back to startupErrorHandler — every dispatched
    # OTel error recursed until the goroutine stack hit 1 GiB and the
    # runtime aborted with exit code 2. The recursion fired the first
    # time the OTLP exporter saw the collector return any error, so a
    # flapping collector took down every gateway pod within seconds.
    @unit @regression
    Scenario: dispatched OTel error invokes the registered handler exactly once
      Given the gateway has installed its OTel error handler
      When the SDK dispatches an exporter error via otel.Handle
      Then the registered handler receives the error exactly once
      And the call does not recurse into itself

  Rule: Collector outage keeps the gateway serving traffic

    @integration @unimplemented
    Scenario: OTLP collector connection-refused does not crash the gateway
      Given the OTLP collector at GATEWAY_OTEL_DEFAULT_ENDPOINT is unreachable
      And the gateway is configured with the default batch span processor
      When 1000 spans are exported over 60 seconds
      Then the gateway process continues serving requests
      And /healthz keeps returning 200 throughout
      And no goroutine stack exceeds 1 MiB

    @integration @unimplemented
    Scenario: empty OTLP endpoint installs a noop tracer provider
      Given GATEWAY_OTEL_DEFAULT_ENDPOINT is empty
      When the gateway boots
      Then otelsetup.New returns a noop Provider
      And no global error handler is registered
      And subsequent otel.Handle calls fall back to the SDK default
