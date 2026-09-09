Feature: The voice worker is opt-in and cannot render half-configured
  As someone who runs LangWatch on their own cluster and wants to let
  scenario/agent runs place and receive phone calls through Twilio,
  I want a voice worker that stays off by default and refuses to render
  without the values it cannot work without,
  so that a default install never grows a WebSocket listener nobody asked
  for, and a misconfigured one fails at render time instead of at runtime.

  # Cross-references:
  #   charts/langwatch/templates/voice/deployment.yaml: the single-replica
  #     Deployment, gated on voice.enabled, and the two `fail` guards this
  #     feature describes.
  #   charts/langwatch/templates/voice/service.yaml,
  #   charts/langwatch/templates/voice/ingress.yaml: the Service and the
  #     opt-in Ingress fronting the Twilio Media Streams WebSocket port.
  #   charts/langwatch/tests/voice-worker.sh: the suite that renders the
  #     chart and asserts what this feature describes.
  #   langwatch/langwatch#8015 and the env contract on #8014
  #     (voice-env-contract comment): VOICE_WORKER_ONLY, VOICE_WS_PORT,
  #     VOICE_PUBLIC_BASE_URL and the three TWILIO_* variables.
  #
  # These scenarios are verified by rendering the chart. The gating
  # condition, the required-value checks, and the env/secretKeyRef wiring
  # are only visible in what actually renders.

  Rule: The default install carries no voice resources

    @e2e
    Scenario: The default install renders no voice resources
      Given a default install, which does not set voice.enabled
      When the chart renders
      Then no templates/voice/ manifest appears in the output

    @e2e
    Scenario: voice.enabled=false explicitly changes nothing
      Given a default install
      When the chart renders once as-is and once with voice.enabled=false set explicitly
      Then the two renders are identical

  Rule: Enabling the voice worker renders a correctly wired Deployment, Service and Ingress

    @e2e
    Scenario: Enabling voice renders a single-replica worker wired to the Twilio secret
      Given voice.enabled=true with a publicBaseUrl and a Twilio existingSecret
      When the chart renders
      Then the voice Deployment has replicas: 1
      And VOICE_WORKER_ONLY is set to "true"
      And TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are read from the named Secret by the configured keys

    @e2e
    Scenario: The voice Deployment's terminationGracePeriodSeconds follows voice.*, not workers.*
      Given voice.enabled=true with a publicBaseUrl and a Twilio existingSecret, voice.terminationGracePeriodSeconds and voice.shutdownDrainSeconds set, and a different workers.terminationGracePeriodSeconds also set
      When the chart renders
      Then the voice Deployment's terminationGracePeriodSeconds comes from voice.terminationGracePeriodSeconds, not from workers.terminationGracePeriodSeconds

    @e2e
    Scenario: Enabling voice renders a Service but no Ingress by default
      Given voice.enabled=true with a publicBaseUrl and a Twilio existingSecret
      When the chart renders
      Then the voice Service targets the voice-ws container port
      And no voice Ingress renders, because voice.ingress.enabled defaults to false

    @e2e
    Scenario: Enabling the voice ingress renders it for the configured host
      Given voice.enabled=true and voice.ingress.enabled=true with a host set
      When the chart renders
      Then the voice Ingress routes that host at the /twilio path

  Rule: A voice worker cannot render without the values it cannot work without

    @e2e
    Scenario: voice.enabled without publicBaseUrl refuses to render
      Given voice.enabled=true with a Twilio existingSecret but no publicBaseUrl
      When the chart renders
      Then the install is refused, naming voice.publicBaseUrl as required

    @e2e
    Scenario: voice.enabled without an existing Twilio secret refuses to render
      Given voice.enabled=true with a publicBaseUrl but no Twilio existingSecret
      When the chart renders
      Then the install is refused, naming voice.twilio.existingSecret as required
