Feature: nlpgo internal authentication — only the LangWatch app may call the engine

  The NLP engine runs workflow nodes, including user-authored Python, on behalf
  of whichever project the LangWatch app names in the request body. It never
  authenticates the project itself, so the engine has to be reachable only by
  the app. Network placement alone carried that until now: the engine listens
  on an internal address and nothing routes to it from outside.

  This adds the application-level half. The app and the engine share one
  secret, `LANGWATCH_NLP_INTERNAL_SECRET`, and the engine refuses any `/go/*`
  request that does not present it in the `X-LangWatch-NLP-Secret` header.

  Health endpoints stay open: they are what Kubernetes probes and the compose
  healthcheck call, and they report liveness only.

  An install that has not set the secret keeps working unauthenticated, which
  is what lets an existing self-hosted deployment upgrade without an outage.
  The engine says so once at startup rather than failing closed on a value its
  operator has never been asked for. The Helm chart and docker compose both
  provision the secret, so new and upgraded installs get it without being
  asked either.

  Rule: With a secret configured, the engine requires it on every /go route

    @unit
    Scenario: a request with no secret header is refused
      Given the engine is configured with an internal secret
      When a caller posts to /go/studio/execute_sync with no secret header
      Then the response status is 401
      And the workflow is not executed

    @unit
    Scenario: a request with the wrong secret is refused
      Given the engine is configured with an internal secret
      When a caller posts to /go/studio/execute_sync with a different secret
      Then the response status is 401
      And the workflow is not executed

    @unit
    Scenario: a request carrying the configured secret is served
      Given the engine is configured with an internal secret
      When the app posts to /go/studio/execute_sync with that secret
      Then the request reaches the engine and is executed

    @unit
    Scenario: the streaming execution route is guarded too
      Given the engine is configured with an internal secret
      When a caller posts to /go/studio/execute with no secret header
      Then the response status is 401

    @unit
    Scenario: the playground proxy route is guarded too
      Given the engine is configured with an internal secret
      When a caller posts to /go/proxy/v1/chat/completions with no secret header
      Then the response status is 401

  Rule: Health endpoints are never guarded

    @unit
    Scenario Outline: a probe reaches the engine without the secret
      Given the engine is configured with an internal secret
      When a probe gets <path> with no secret header
      Then the response status is not 401

      Examples:
        | path      |
        | /healthz  |
        | /readyz   |
        | /startupz |

  Rule: An install with no secret configured keeps serving

    @unit
    Scenario: an unconfigured engine serves a request with no secret header
      Given the engine is configured with no internal secret
      When a caller posts to /go/studio/execute_sync with no secret header
      Then the request reaches the engine and is executed

    @unit
    Scenario: an unconfigured engine reports the gap at startup
      Given the engine is configured with no internal secret
      When the engine starts
      Then it logs that /go routes accept unauthenticated callers

  Rule: The app presents the secret on every call it makes to the engine

    @unit
    Scenario: the shared helper carries the secret when one is configured
      Given the app environment names an internal secret
      When the app builds the headers for a request to the engine
      Then the headers carry the secret

    @unit
    Scenario: the shared helper carries nothing when none is configured
      Given the app environment names no internal secret
      When the app builds the headers for a request to the engine
      Then the headers carry no secret
