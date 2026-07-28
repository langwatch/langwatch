Feature: Blocking the private control plane at the chart's ingress
  As an operator installing LangWatch from the Helm chart
  I need the app's private control-plane paths to be unreachable from the internet
  by default, and I need the chart to refuse any configuration that quietly
  undoes that block
  So that a leaked or brute-forced shared secret is not the only thing standing
  between the public internet and the Langy and AI-gateway callback surface.

  Background:
    Everything under /api/internal/* is the app's private control plane: the Langy
    agent manager's callbacks (langy-internal.ts, langy-relay.ts) and the AI
    gateway's usage callbacks (gateway-internal.ts). Each is authenticated by a
    single shared secret — a bearer token for Langy, an HMAC signature for the
    gateway — which is a last line of defence, not a reason to publish the surface.
    This is the edge-side complement to the route-level policies in
    api-endpoint-authorization.feature, where these routes declare
    internalSecret(reason).

    The chart's ingress routes a catch-all "/" to the app, so before this feature
    every one of those paths was internet-reachable on a default install.

    The mechanism: for each prefix in ingress.blockedPaths the chart renders an
    Ingress path (pathType: Prefix) pointing at a dedicated Service that has no
    selector. Nothing populates that Service's Endpoints, so the controller has
    nowhere to forward the request and answers 404 or 503 depending on the
    controller. All of them fail closed, which is the property that matters.

  # ============================================================================
  Rule: The private control plane is blocked by default

    Scenario: A default install with the ingress enabled blocks the control plane
      Given an operator installs the chart with the ingress enabled
      And they have not configured ingress.blockedPaths
      When the chart renders
      Then requests to /api/internal are routed to the blackhole, not the app
      And the blackhole Service has no selector, so it can never forward anywhere
      And the application's own paths still route to the app

    Scenario: The block covers the whole control-plane subtree, not just its root
      Given the default blocked prefix /api/internal
      When the chart renders
      Then the blocked path matches by prefix, so every path beneath it is blocked
      # An exact match would block only the literal /api/internal and let every
      # real route (/api/internal/langy/*, /api/internal/gateway/*) through.

    Scenario: Blocked paths are ordered ahead of the application's paths
      Given an ingress with both blocked prefixes and application paths
      When the chart renders
      Then the blocked paths appear before the application paths
      # Longest-match is what carries the block on most controllers; the ordering
      # is a hedge for controllers that derive rule priority from list position.

    Scenario: Nothing is rendered when the ingress is disabled
      Given an operator installs the chart with the ingress disabled
      When the chart renders
      Then neither the blocked paths nor the blackhole Service exist

  # ============================================================================
  Rule: The chart refuses any configuration that silently defeats the block

    A configuration that defeats the block is worse than no block, because the
    blocked path and the blackhole Service are both still rendered — the install
    looks protected while the control plane is served to the internet. Every such
    configuration is rejected at render time, by name, rather than shipped.

    Scenario: An application path nested under a blocked prefix is refused
      Given the blocked prefix /api/internal
      And an application path /api/internal/status
      When the chart renders
      Then the render fails naming the offending path and the prefix
      # The nested path is a longer match, so it would out-match the blackhole.

    Scenario: An application path equal to a blocked prefix is refused
      Given the blocked prefix /api/internal
      And an application path /api/internal
      When the chart renders
      Then the render fails naming the offending path and the prefix

    Scenario: A sibling path outside the blocked prefix is still allowed
      Given the blocked prefix /api/internal
      And an application path /api/internal-status
      When the chart renders
      Then the render succeeds and that path routes to the app
      # Prefix matching is on "/"-separated segments, so the sibling is genuinely
      # outside the block. Rejecting it would break a legitimate application path.

    Scenario: A nested path on any host is refused, not just the first
      Given an ingress serving two hosts
      And the second host has a path nested under a blocked prefix
      When the chart renders
      Then the render fails naming that path

    Scenario Outline: A malformed blocked prefix is refused rather than ignored
      Given ingress.blockedPaths contains <prefix>
      When the chart renders
      Then the render fails explaining <reason>

      Examples:
        | prefix            | reason                                                        |
        | "/api/internal/"  | a trailing slash would stop the nested-path check from firing |
        | "api/internal"    | a path without a leading slash is not a valid Ingress path    |
        | "/"               | blocking "/" would route the entire site to the blackhole     |
        | a non-list value  | plain --set assigns a string, which half-renders the block    |

  # ============================================================================
  Rule: Operators can opt out, knowingly and completely

    Scenario: Emptying the list removes the block entirely
      Given an operator sets ingress.blockedPaths to an empty list
      When the chart renders
      Then no blocked paths are rendered
      And the blackhole Service is not rendered
      And an application path under /api/internal no longer refuses to render
      # The opt-out has to drop the guard too, or an operator who has knowingly
      # disabled the block would still be blocked from configuring their paths.

    Scenario: Operators can block additional prefixes
      Given an operator adds /api/cron to ingress.blockedPaths
      When the chart renders
      Then both /api/internal and /api/cron are routed to the blackhole
      # /api/cron, /metrics and /api/ops are internal-only in the default topology
      # but are NOT blocked by default: some installs drive cron from an external
      # scheduler, federate metrics, or run operator tooling from outside.

  # ============================================================================
  Rule: The guarantee is scoped to this ingress

    Scenario: Publishing the app by another route does not inherit the block
      Given an operator exposes the app with a NodePort or LoadBalancer Service
      Or they write their own Ingress pointing at the app Service
      When they reach the app by that route
      Then these prefixes do not apply
      # The block is a property of this ingress, the chart's public entrypoint,
      # not of the application. Such installs need an equivalent restriction
      # wherever that route terminates.

    Scenario: In-cluster callers are unaffected
      Given the Langy agent manager, the AI gateway, and the chart's CronJobs
      When they call the control plane
      Then they reach the app through its internal Service, never the ingress
      And the block changes nothing for them
