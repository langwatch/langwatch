Feature: Blocking the private control plane at the chart's ingress
  As an operator installing LangWatch from the Helm chart
  I need `/api/internal/*` unreachable from the internet by default, and the
  chart to refuse any configuration that quietly undoes that
  So that a leaked shared secret is not the only thing between the public
  internet and the Langy and AI-gateway callback surface.

  Background:
    `/api/internal/*` is the private control plane — Langy agent callbacks and
    AI-gateway usage callbacks, each authenticated by a single shared secret.
    The chart's catch-all "/" would otherwise publish it. This is the edge-side
    complement to the route policies in api-endpoint-authorization.feature.

    Mechanism: each prefix in ingress.blockedPaths renders an Ingress path
    (pathType: Prefix) pointing at a Service with no selector. Nothing populates
    its Endpoints, so the controller cannot forward anywhere — 503 on
    ingress-nginx. The exact code is controller-dependent; failing closed is not.

  # Tagging. Every scenario here is verified by charts/langwatch/tests/e2e-overlays.sh
  # (test_access_ingress), which runs in CI via `make test-e2e-overlays`. They carry
  # @unimplemented because the parity checker scans .bats files under
  # DEFAULT_BATS_TEST_ROOTS and cannot see a .sh suite under charts/ — the gap is in
  # the checker's reach, not in the coverage. See LEGACY_INERT in
  # langwatch/scripts/check-feature-parity.ts.

  Rule: The private control plane is blocked by default

    @e2e @unimplemented

    Scenario: A default install with the ingress enabled blocks the control plane
      Given an operator enables the ingress without configuring blockedPaths
      When the chart renders
      Then /api/internal is routed to the blackhole, not the app
      And the blackhole Service has no selector
      And the application's own paths still route to the app

    @e2e @unimplemented

    Scenario: The block covers the subtree, not just its root
      When the chart renders
      Then the blocked path matches by prefix, so every path beneath it is blocked
      # Exact would block only the literal /api/internal and let every real
      # route (/api/internal/langy/*, /api/internal/gateway/*) through.

    @e2e @unimplemented

    Scenario: Blocked paths are ordered ahead of the application's paths
      When the chart renders
      Then the blocked paths appear first
      # Longest-match carries the block; the ordering hedges controllers that
      # rank rules by list position.

    @e2e @unimplemented

    Scenario: Nothing renders when the ingress is disabled
      Given the ingress is disabled
      When the chart renders
      Then neither the blocked paths nor the blackhole Service exist

  Rule: The chart refuses configurations that silently defeat the block

    A defeated block is worse than none: the blocked path and the blackhole are
    still rendered, so the install looks protected while the control plane is
    served to the internet.

    @e2e @unimplemented

    Scenario Outline: A path that would out-match the blackhole is refused
      Given the blocked prefix /api/internal
      And an application path <path>
      When the chart renders
      Then the render fails naming the path and the prefix

      Examples:
        | path                  |
        | /api/internal/status  |
        | /api/internal         |

    @e2e @unimplemented

    Scenario: A nested path on any host is refused, not just the first
      Given an ingress serving two hosts
      And the second host has a path nested under a blocked prefix
      When the chart renders
      Then the render fails naming that path

    @e2e @unimplemented

    Scenario: A sibling path outside the blocked prefix is still allowed
      Given an application path /api/internal-status
      When the chart renders
      Then the render succeeds and that path routes to the app
      # Prefix matching is on "/"-separated segments, so the sibling is genuinely
      # outside the block; rejecting it would break a legitimate path.

    @e2e @unimplemented

    Scenario Outline: A malformed prefix is refused rather than ignored
      Given ingress.blockedPaths contains <prefix>
      When the chart renders
      Then the render fails explaining <reason>

      Examples:
        | prefix            | reason                                                     |
        | "/api/internal/"  | a trailing prefix slash matches no request path            |
        | "/api/internal//" | an empty path segment matches no request path              |
        | "/api/internal "  | surrounding whitespace matches no request path             |
        | "api/internal"    | a path without a leading slash is not a valid Ingress path |
        | "/"               | blocking "/" would route the entire site to the blackhole  |
        | a non-list value  | plain --set assigns a string, which half-renders the block |

    @e2e @unimplemented

    Scenario: A regex path that outranks the blackhole is refused
      Given ingress.hosts contains a pathType ImplementationSpecific path with regex metacharacters
      And ingress.blockedPaths is not empty
      When the chart renders
      Then the render fails explaining that controllers honouring regex rank it above the block

    @e2e @unimplemented

    Scenario: An annotation that reroutes the blackhole is refused
      Given ingress.annotations sets a default-backend
      And ingress.blockedPaths is not empty
      When the chart renders
      Then the render fails explaining that it would forward the blocked paths instead

    @e2e @unimplemented

    Scenario: A host with no paths is refused
      Given an ingress.hosts entry whose http.paths list is empty
      When the chart renders
      Then the render fails rather than emitting an Ingress whose only rules are blackholes

  Rule: Operators can opt out, knowingly and completely

    @e2e @unimplemented

    Scenario: Emptying the list removes the block entirely
      Given an operator sets ingress.blockedPaths to an empty list
      When the chart renders
      Then no blocked paths and no blackhole Service are rendered
      And an application path under /api/internal no longer refuses to render
      # The opt-out drops the guard too, or an operator who knowingly disabled
      # the block would still be blocked from configuring their paths.

    @e2e @unimplemented

    Scenario: Operators can block additional prefixes
      Given an operator adds /api/cron to ingress.blockedPaths
      When the chart renders
      Then both /api/internal and /api/cron are routed to the blackhole
      # /api/cron, /metrics and /api/ops are internal-only in the default
      # topology but are not blocked by default — some installs drive cron
      # externally, federate metrics, or run ops tooling from outside.

  Rule: The guarantee is scoped to this ingress

    @e2e @unimplemented

    Scenario: Publishing the app by another route does not inherit the block
      Given an operator exposes the app by NodePort, LoadBalancer, or their own Ingress
      When they reach the app by that route
      Then these prefixes do not apply
      # The block is a property of this ingress, not of the application.

    @e2e @unimplemented

    Scenario: In-cluster callers are unaffected
      Given the Langy agent, the AI gateway, and the chart's CronJobs
      When they call the control plane
      Then they reach the app through its internal Service, never the ingress
