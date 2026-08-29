Feature: One checked code-block ceiling reaches every process that talks to nlpgo
  As someone running LangWatch on my own cluster,
  I want the code-block ceiling I set to be checked wherever it is handed out,
  so that no process ends up enforcing a deadline shorter than the engine's own
  and cutting off runs the engine is still legitimately working on.

  # Cross-references:
  #   charts/langwatch/templates/_helpers.tpl — langwatch.codeBlockTimeoutSeconds
  #     (the check and the value) and langwatch.assertNoReservedTimeoutEnvs.
  #   charts/langwatch/templates/{app,workers,langwatch_nlp}/deployment.yaml —
  #     the three places the number is emitted.
  #   platform/app/src/server/nlpgo/timeouts.ts — the client side, which DERIVES
  #     its fetch deadline from this number.
  #   charts/langwatch/tests/nlpgo-timeout-guard.sh — the test that renders the
  #     chart and asserts what each component receives.
  #
  # Context. NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is a single operator knob
  # read on BOTH sides of the socket: nlpgo enforces it, and the app and the
  # workers derive their client-side fetch deadline from it (ceiling + fixed
  # headroom). That is deliberate — the two used to be independent numbers, and
  # raising the engine's ceiling while the client kept its own 120s abort is how
  # a live production bug happened.
  #
  # Because the number is shared, WHERE it is checked matters. The app and the
  # workers are given it by the shared-env helper, and they render whether or
  # not this chart deploys the NLP service: langwatch_nlp.enabled false is a
  # supported mode for an external, shared or serverless engine. A check that
  # lives inside the NLP Deployment does not run in that mode, so the number
  # reaches the clients unchecked — and a shortened one makes them abort turns
  # the external engine, still on its own ceiling, is working on.
  #
  # These scenarios are verified by rendering the chart. Grepping the template
  # for the check proves nothing about which components the value reaches, or
  # about which renders the check actually runs in.

  Rule: The ceiling is checked where the value is handed out, not where the service is deployed

    @e2e
    Scenario: Every nlpgo caller is given the same code-block ceiling
      Given a default install
      When the chart renders
      Then the app, the workers and the NLP service all carry the same ceiling

    @e2e
    Scenario: A code-block ceiling at or above the stream idle timeout is refused
      Given a ceiling at or above the engine's stream idle timeout
      When the chart renders
      Then the install is refused, because such a ceiling races the stream shutting down

    @e2e
    Scenario: The ceiling is still checked when the NLP service is external
      Given an install that runs nlpgo outside this chart
      And a ceiling the chart would refuse for its own NLP service
      When the chart renders
      Then the install is refused just the same
      And a shortened ceiling is refused too, because the chart cannot impose it on that engine

    @e2e
    Scenario: An external NLP service still leaves the clients installable
      Given an install that runs nlpgo outside this chart
      And a ceiling left alone
      When the chart renders
      Then the app and the workers are given the engine's own default

  Rule: The operator cannot route around the check

    @e2e
    Scenario: A reserved timeout variable cannot be smuggled in through extraEnvs
      Given an operator who sets a reserved timeout variable through extraEnvs
      When the chart renders
      Then the install is refused for every component that accepts extra variables
