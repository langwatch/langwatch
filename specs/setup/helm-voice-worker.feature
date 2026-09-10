Feature: The voice worker is opt-in and cannot render half-configured
  As someone who runs LangWatch on their own cluster and wants to let
  scenario/agent runs place and receive phone calls through Twilio,
  I want a voice worker that stays off by default and refuses to render
  without the values it cannot work without,
  so that a default install never grows a WebSocket listener nobody asked
  for, and a misconfigured one fails at render time instead of at runtime.

  # Cross-references:
  #   charts/langwatch/templates/voice/deployment.yaml: the single-replica
  #     Deployment, gated on voice.enabled, and the `fail` guard this
  #     feature describes.
  #   charts/langwatch/templates/voice/service.yaml,
  #   charts/langwatch/templates/voice/ingress.yaml: the Service and the
  #     opt-in Ingress fronting the Twilio Media Streams WebSocket port.
  #   charts/langwatch/tests/voice-worker.sh: the suite that renders the
  #     chart and asserts what this feature describes.
  #   langwatch/langwatch#8015 and the env contract on #8014
  #     (voice-env-contract comment): VOICE_WORKER_ONLY, VOICE_WS_PORT and
  #     VOICE_PUBLIC_BASE_URL. Call-provider credentials are per-project
  #     data configured inside LangWatch, not chart values or operator env.
  #
  # These scenarios are verified by rendering the chart. The gating
  # condition, the required-value checks, and the env/secretKeyRef wiring
  # are only visible in what actually renders.

  Rule: The default install carries no voice resources

    @e2e
    Scenario: The voice worker is not deployed unless the operator turns it on
      Given a default install, which does not opt into the voice worker
      When the chart renders
      Then no voice worker resources appear anywhere in the output

    @e2e
    Scenario: Turning the voice worker off explicitly changes nothing
      Given a default install
      When the chart renders once as-is and once with the voice worker explicitly turned off
      Then the two renders are identical

  Rule: Enabling the voice worker renders a correctly wired Deployment, Service and Ingress

    @e2e
    Scenario: Turning on the voice worker brings up a single call handler
      Given the voice worker is turned on with its public address configured
      When the chart renders
      Then exactly one voice worker instance comes up
      And it runs in voice-only mode

    @e2e
    Scenario: The voice worker's shutdown timing is its own, not borrowed from the background workers
      Given the voice worker is turned on with its own shutdown timing configured differently from the background workers' shutdown timing
      When the chart renders
      Then the voice worker shuts down on its own configured timeline
      And the background workers' shutdown timing has no effect on it

    @e2e
    Scenario: The voice worker is reachable inside the cluster by default, but not exposed publicly
      Given the voice worker is turned on
      When the chart renders
      Then other workloads in the cluster can reach the voice worker over its call-handling port
      And no public entry point is created for it, because that step is opt-in

    @e2e
    Scenario: The voice worker gets its own public hostname for Twilio to call
      Given the voice worker is turned on and its public entry point is also turned on with a hostname set
      When the chart renders
      Then the voice worker is reachable at that hostname on the path Twilio calls

    @e2e
    Scenario: The voice worker refuses to expose a hostname that doesn't match its own public address
      Given the voice worker's public entry point is turned on with a hostname that disagrees with the voice worker's own configured public address
      When the chart renders
      Then the install is refused, because Twilio would call one address while the public entry point routes another

  Rule: A voice worker cannot render without the values it cannot work without

    @e2e
    Scenario: The voice worker refuses to start without knowing its own public address
      Given the voice worker is turned on with no public address set
      When the chart renders
      Then the install is refused, naming the missing public address

    @e2e
    Scenario: The voice worker refuses a public address that is not a valid https:// origin
      Given the voice worker is turned on with its public address set to a plain http:// URL
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: Turning on the voice worker with a valid https:// public address renders
      Given the voice worker is turned on with its public address set to a valid https:// origin
      When the chart renders
      Then the voice worker comes up with that public address configured

    @e2e
    Scenario: Turning on the voice worker with a valid https:// public address including a port renders
      Given the voice worker is turned on with its public address set to a valid https:// origin that includes a port
      When the chart renders
      Then the voice worker comes up with that public address, port included, configured

    @e2e
    Scenario: The voice worker refuses a public address that includes a path
      Given the voice worker is turned on with its public address set to an https:// origin that includes a path
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address that includes a query string
      Given the voice worker is turned on with its public address set to an https:// origin that includes a query string
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address with a trailing slash
      Given the voice worker is turned on with its public address set to an https:// origin with a trailing slash
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address with a malformed hostname
      Given the voice worker is turned on with its public address set to an https:// origin with no hostname, or one starting with a hyphen
      When the chart renders
      Then the install is refused, naming the invalid public address
