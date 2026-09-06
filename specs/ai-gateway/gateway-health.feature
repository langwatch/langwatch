Feature: Gateway status-page health endpoint

  # GET /health on the Go gateway (services/aigateway) is the public
  # surface the LangWatch status page (status.langwatch.ai) polls, the
  # gateway's sibling of the app's /api/health/* subsystem monitors.
  # Plain HTTP monitor semantics: 200 healthy, 503 unhealthy.
  #
  # Distinct from the k8s probes in health-checks.feature: /healthz,
  # /readyz and /startupz gate pod lifecycle in-cluster, while /health is
  # exposed through the ingress and reports the service as a whole.
  #
  # The load-bearing property: the verdict covers the gateway process and
  # the dependencies LangWatch owns (the control plane, reached over the
  # HMAC-signed internal channel). Model providers are deliberately
  # excluded, in both directions: dispatch outcomes never feed the
  # verdict, and a poll never triggers an upstream call. OpenAI or
  # Anthropic being down is their status page's news, not ours, and a
  # public unauthenticated endpoint that fanned out per poll would be an
  # amplification and cost bug besides.
  #
  # Control-plane semantics: a background monitor probes the signed
  # /api/internal/gateway/health route on its own clock (default every
  # 15s) and /health serves the cached verdict. Unreachability shorter
  # than the tolerance (default 60s) stays 200 because the auth cache's
  # stale-while-error machinery keeps warm traffic serving through a
  # blip; sustained unreachability flips 503 because cold-cache requests
  # are by then failing with auth_upstream errors.

  Background:
    Given the Go gateway service is running

  Rule: The verdict is independent of model providers

    @unit
    Scenario: a total model provider outage never turns gateway health red
      Given every model provider dispatch fails as if OpenAI and Anthropic are down
      And completion requests through the gateway are returning 5xx
      When I GET "/health"
      Then the response status is 200
      And the response JSON has "status" == "ok"

    @unit
    Scenario: polling the status endpoint puts no load on anything else
      Given a status page free to poll as hard as it likes
      When I GET "/health" 50 times
      Then every response is 200
      And no model provider was called
      And the control plane was not called
      # Poll rate and the cost of answering are unrelated. On a public
      # unauthenticated endpoint, anything else is an amplification and a
      # bill someone else gets to write.

  Rule: The verdict covers the dependencies LangWatch owns

    @unit
    Scenario: healthy gateway reports ok with a component breakdown
      Given the control-plane monitor has a recent successful probe
      When I GET "/health"
      Then the response status is 200
      And the response JSON has "checks.gateway" == "ok"
      And the response JSON has "checks.control_plane" == "ok"

    @unit
    Scenario: control plane blip within the warm-cache window stays healthy
      Given the control plane has been unreachable for 30 seconds
      When the monitor evaluates the control-plane component
      Then the component is healthy
      # Warm-cache traffic is unaffected during a short blip, and the
      # status page must not flap on what customers cannot feel.

    @unit
    Scenario: sustained control plane outage flips health to 503
      Given the control plane has been unreachable for longer than the tolerance
      When I GET "/health"
      Then the response status is 503
      And the response JSON has "status" == "degraded"
      And the response JSON "checks.control_plane" contains "unreachable"

    @unit
    Scenario: recovery after an outage returns health to 200
      Given the control plane was unreachable for longer than the tolerance
      When the control plane becomes reachable again
      And the background monitor completes a successful probe
      Then the control-plane component is healthy again

  Rule: The response is safe for public polling

    @unit
    Scenario: health response carries no tenant data or internal endpoints
      When I GET "/health" in both healthy and degraded states
      Then the response JSON has exactly the keys "status" and "checks"
      And no URL, hostname, or port appears anywhere in the body
      And no tenant, project, or key identifier appears anywhere in the body

    @unit
    Scenario: HEAD polls get the same verdict as GET
      When I HEAD "/health"
      Then the response status matches the GET verdict
      And the response has no body

  Rule: The control-plane probe rides the signed internal channel

    # A successful probe proves the whole channel the gateway needs to
    # serve traffic: DNS, TCP/TLS, the app being up, and the shared HMAC
    # secret matching. A wrong secret is the misconfig where every pod
    # looks green while every virtual-key resolve is refused; this probe
    # is what catches it.

    @unit
    Scenario: a mismatched internal secret shows up as a control-plane failure
      Given the gateway and the control plane hold different internal secrets
      When the gateway probes the control plane
      Then the control plane refuses the probe
      And the gateway records the probe as failed
      # The whole reason the probe rides the signed channel. An unsigned
      # liveness ping would report green while every virtual-key resolve
      # is being refused.

    @integration
    Scenario: control plane answers the gateway's signed health probe
      Given a request signed with the shared internal secret
      When the control plane receives GET "/api/internal/gateway/health"
      Then the response status is 200
      And the response JSON has "status" == "ok"

    @integration
    Scenario: unsigned health probes to the control plane are rejected
      Given a request without signature headers
      When the control plane receives GET "/api/internal/gateway/health"
      Then the response status is 401
