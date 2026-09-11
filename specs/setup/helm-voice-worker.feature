Feature: The voice worker needs zero extra configuration to route phone simulations, and cannot render half-configured
  As someone who runs LangWatch on their own cluster and wants to let
  scenario/agent runs place and receive phone calls through Twilio,
  I want a voice worker that comes up on its own once the cluster already
  has a public https:// URL, refuses to render without the values it
  cannot work without, and never fails a stock install that has no such
  URL yet,
  so that turning on phone simulations costs nothing beyond what most
  installs already have, a misconfigured explicit value fails at render
  time instead of at runtime, and a default install never crashes over a
  feature nobody asked to configure yet.

  # Cross-references:
  #   charts/langwatch/templates/_helpers.tpl: langwatch.voice.publicBaseUrl,
  #     the helper that resolves the public origin (explicit value, then
  #     app.http.publicUrl, then unresolved) which every scenario below
  #     ultimately depends on.
  #   charts/langwatch/templates/voice/deployment.yaml: the single-replica
  #     Deployment, gated on voice.enabled AND a resolved public origin, and
  #     the `fail` guard this feature describes.
  #   charts/langwatch/templates/voice/service.yaml,
  #   charts/langwatch/templates/voice/ingress.yaml: the Service and the
  #     Ingress fronting the Twilio Media Streams WebSocket port, both on by
  #     default and gated the same way as the Deployment.
  #   charts/langwatch/tests/voice-worker.sh: the suite that renders the
  #     chart and asserts what this feature describes.
  #   langwatch/langwatch#8015 and the env contract on #8014
  #     (voice-env-contract comment): VOICE_WORKER_ONLY, VOICE_WS_PORT and
  #     VOICE_PUBLIC_BASE_URL. Call-provider credentials are per-project
  #     data configured inside LangWatch, not chart values or operator env.
  #
  # These scenarios are verified by rendering the chart. The gating
  # condition, the resolution priority, the required-value checks, and the
  # env/secretKeyRef wiring are only visible in what actually renders.

  Rule: The voice worker renders nothing until a public https:// origin can be resolved

    @e2e
    Scenario: A stock install with no https:// URL anywhere renders no voice resources
      Given a default install, where neither the app's own public URL nor a
        dedicated voice public address is an https:// origin
      When the chart renders
      Then no voice worker resources appear anywhere in the output
      And the install still succeeds

    @e2e
    Scenario: The voice worker does not render when only an http:// URL is available
      Given the voice worker is left at its default (turned on) and the
        app's own public URL is a plain http:// address
      When the chart renders
      Then no voice worker resources appear anywhere in the output
      And the install still succeeds

    @e2e
    Scenario: Explicitly turning the voice worker off overrides a resolvable https:// URL
      Given the app's own public URL is a valid https:// origin, but the
        voice worker is explicitly turned off
      When the chart renders
      Then no voice worker resources appear anywhere in the output

  Rule: Renders by default once a public https:// origin resolves, with a correctly wired Deployment, Service and Ingress

    @e2e
    Scenario: Renders by default when an https:// public URL is configured
      Given the app's own public URL is a valid https:// origin, and nothing
        else about voice is configured
      When the chart renders
      Then exactly one voice worker instance comes up
      And it runs in voice-only mode
      And it is reachable inside the cluster over its call-handling port
      And it is also reachable from outside the cluster, because the public
        entry point is on by default too

    @e2e
    Scenario: Turning on the voice worker brings up a single call handler
      Given the voice worker's own public address is set to a valid https://
        origin
      When the chart renders
      Then exactly one voice worker instance comes up
      And it runs in voice-only mode

    @e2e
    Scenario: The voice worker is reachable inside the cluster and exposed for Twilio by default
      Given the voice worker's own public address is set to a valid https://
        origin, and nothing about its public entry point is configured
      When the chart renders
      Then the voice worker is reachable inside the cluster on its
        call-handling port
      And a public entry point for it renders too, without any extra
        configuration

    @e2e
    Scenario: The voice worker's shutdown timing is its own, not borrowed from the background workers
      Given the voice worker is turned on with its own shutdown timing configured differently from the background workers' shutdown timing
      When the chart renders
      Then the voice worker shuts down on its own configured timeline
      And the background workers' shutdown timing has no effect on it

    @e2e
    Scenario: The voice worker's public hostname defaults to its resolved public address
      Given the voice worker's own public address is set to a valid https://
        origin, and no separate Ingress hostname is configured
      When the chart renders
      Then the voice worker is reachable at that address's hostname on the
        path Twilio calls

    @e2e
    Scenario: The voice worker's ingress carries WebSocket-safe timeout annotations by default
      Given the voice worker is turned on with its public entry point active,
        and no custom ingress annotations are set
      When the chart renders
      Then the ingress carries timeout annotations long enough for a call to
        survive longer than a minute

    @e2e
    Scenario: An explicit public hostname for the voice worker still works
      Given the voice worker's own public address is set to a valid https://
        origin, and its public entry point's hostname is explicitly set to
        match it
      When the chart renders
      Then the voice worker is reachable at that hostname on the path Twilio
        calls

    @e2e
    Scenario: The voice worker refuses to expose a hostname that doesn't match its own public address
      Given the voice worker's public entry point's hostname is set to
        disagree with the voice worker's own configured public address
      When the chart renders
      Then the install is refused, because Twilio would call one address while the public entry point routes another

  Rule: An explicit voice public address always wins over the app's own public URL, even a bad one

    @e2e
    Scenario: An explicit voice public address wins over the app's own public URL
      Given both the app's own public URL and the voice worker's own public
        address are set to different valid https:// origins
      When the chart renders
      Then the voice worker comes up with its own configured public address,
        not the app's

    @e2e
    Scenario: An explicit bad voice public address still fails even when the app's own public URL would resolve on its own
      Given the app's own public URL is a valid https:// origin, but the
        voice worker's own public address is explicitly set to a plain
        http:// URL
      When the chart renders
      Then the install is refused, naming the invalid public address

  Rule: A voice worker cannot render without a validly-shaped public address

    @e2e
    Scenario: The voice worker refuses a public address that is not a valid https:// origin
      Given the voice worker's own public address is set to a plain http:// URL
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: Turning on the voice worker with a valid https:// public address renders
      Given the voice worker's own public address is set to a valid https:// origin
      When the chart renders
      Then the voice worker comes up with that public address configured

    @e2e
    Scenario: Turning on the voice worker with a valid https:// public address including a port renders
      Given the voice worker's own public address is set to a valid https:// origin that includes a port
      When the chart renders
      Then the voice worker comes up with that public address, port included, configured

    @e2e
    Scenario: The voice worker refuses a public address whose port is out of range
      Given the voice worker's own public address is set to an https:// origin whose port is 65536
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address that includes a path
      Given the voice worker's own public address is set to an https:// origin that includes a path
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address that includes a query string
      Given the voice worker's own public address is set to an https:// origin that includes a query string
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address with a trailing slash
      Given the voice worker's own public address is set to an https:// origin with a trailing slash
      When the chart renders
      Then the install is refused, naming the invalid public address

    @e2e
    Scenario: The voice worker refuses a public address with a malformed hostname
      Given the voice worker's own public address is set to an https:// origin with no hostname, or one starting with a hyphen
      When the chart renders
      Then the install is refused, naming the invalid public address
