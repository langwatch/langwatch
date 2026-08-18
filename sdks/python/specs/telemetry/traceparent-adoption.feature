Feature: Remote traceparent adoption across tracing styles
  As a developer whose agent endpoint is called by LangWatch simulations
  I want every tracing style the SDK proposes to join the caller's trace
  So that the judge finds the agent's spans under the trace id it propagated

  # LangWatch sends a W3C traceparent header on every scenario call. The
  # extracted context must be attached BEFORE any tracing starts, because a
  # handler decorated with @langwatch.trace() opens its root span before the
  # handler body runs. Middleware-level attach() covers every style; a
  # with-block around the handler body only covers traces started inside it.

  Scenario: Attach before a decorated handler joins the remote trace
    Given the remote context is attached before the handler runs
    When a handler decorated with @langwatch.trace() executes
    Then its root span carries the remote trace id
    And its root span's parent is the remote caller's span

  Scenario: A decorated handler without early extraction starts its own trace
    Given no remote context is attached before the handler runs
    When a handler decorated with @langwatch.trace() executes
    Then its root span carries a fresh trace id

  Scenario: Attach covers plain OpenTelemetry spans
    Given the remote context is attached
    When the handler opens a plain OpenTelemetry span
    Then the span carries the remote trace id

  Scenario: Attach covers a context-manager trace and its nested spans
    Given the remote context is attached
    When the handler runs inside "with langwatch.trace()" and opens a nested span
    Then every span carries the remote trace id

  Scenario: A with-block covers a trace started inside it
    Given the handler wraps its body in a span opened with the extracted context
    When a langwatch trace starts inside that block
    Then every span carries the remote trace id
