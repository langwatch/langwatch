@unimplemented
Feature: Langy worker egress enforcement — monitor first, enforce last
  As the operator of the langy-agent backend, and as a customer whose project
  Langy acts on
  I want outbound traffic from a prompt-injectable Langy worker to be watched by
  default and restricted only to the destinations the customer trusts
  So that a compromised worker cannot exfiltrate the live LangWatch key, gateway
     key, GitHub token, or the customer's trace/PII data to an attacker host,
     while a customer who has configured nothing is never silently broken

  # ---------------------------------------------------------------------------
  # Background: the threat and the layering
  #
  # Each worker holds a different user's live credentials and runs LLM-generated
  # shell, so outbound exfiltration is the top risk. The pod runs under gVisor,
  # where kernel netfilter is unavailable (ADR-033) — so iptables redirect / NAT
  # / OWNER-match cannot gate egress. NetworkPolicy bounds L3/L4 (deny-by-default
  # with RFC-1918 + the cloud metadata service carved out) but cannot express
  # FQDN egress without a CNI like Cilium.
  #
  # PR1 adds a per-worker egress adapter (a forward proxy the worker's tools
  # egress through, mirroring the inbound authProxy). PR3 adds MONITORING on that
  # adapter: every outbound flow is observed, attributed to a worker/conversation,
  # and flagged — but nothing is blocked. This feature (PR4) adds the ENFORCEMENT
  # rungs on top, in the order monitoring earned:
  #   0. always-on monitoring (from PR3) — every rung below also flags
  #   1. require TLS + per-destination throttle
  #   2. customer allow-list: unset -> monitor only; set -> restrict to it
  #   3. always-on FQDN floor (github / gateway / control-plane), once proven
  #
  # The customer allow-list is a per-project setting resolved by the control
  # plane and threaded into the per-request credentials envelope; the adapter is
  # constructed with that worker's list at spawn.
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Rung 0 / Rung 2 default — no allow-list means monitor, not block
  # ===========================================================================

  Scenario: With no allow-list, outbound traffic is monitored but allowed
    Given a project has not configured a Langy egress allow-list
    And a worker is running for a conversation in that project
    When the worker makes an outbound TLS connection to any external host
    Then the connection is allowed
    And the destination is recorded and attributed to the worker's conversation
    And nothing is blocked on allow-list grounds

  Scenario: With no allow-list, a suspicious destination is flagged without being blocked
    Given a project has not configured a Langy egress allow-list
    And a worker is running for a conversation in that project
    When the worker connects to a destination never seen for that project before
    Then the connection is allowed
    And the destination is flagged as anomalous for an operator to review

  # ===========================================================================
  # Rung 2 — allow-list set means restrict to it
  # ===========================================================================

  Scenario: With an allow-list set, a listed host is allowed
    Given a project's Langy egress allow-list contains "registry.npmjs.org"
    And a worker is running for a conversation in that project
    When the worker makes an outbound TLS connection to "registry.npmjs.org"
    Then the connection is allowed
    And the destination is recorded and attributed to the worker's conversation

  Scenario: With an allow-list set, a non-listed host is blocked and flagged
    Given a project's Langy egress allow-list contains "registry.npmjs.org"
    And a worker is running for a conversation in that project
    When the worker attempts an outbound TLS connection to "attacker.example.com"
    Then the connection is denied at the egress adapter
    And the destination never receives any bytes
    And the denied attempt is flagged and attributed to the worker's conversation

  Scenario: Changing the allow-list does not leave a live worker on the old policy
    Given a worker is running under a project with allow-list "a.example.com"
    When the project's allow-list is changed to "b.example.com"
    And the same conversation takes its next turn
    Then the worker is recycled so it runs under the new allow-list
    And a request to "b.example.com" is allowed
    And a request to "a.example.com" is denied

  # ===========================================================================
  # Rung 1 — require TLS
  # ===========================================================================

  Scenario: Cleartext egress to an external host is refused
    Given a worker is running for a conversation
    When the worker attempts a plaintext HTTP request to an external host
    Then the request is refused at the egress adapter
    And the worker cannot send the bytes over cleartext to a public destination

  Scenario: TLS egress to an allowed host still succeeds
    Given a worker is running for a conversation
    And the destination host is permitted for that worker
    When the worker opens a TLS tunnel to that host
    Then the tunnel is established and the request succeeds

  # ===========================================================================
  # Rung 1 — per-destination throttle
  # ===========================================================================

  Scenario: A high-volume flow to a single destination is throttled and flagged
    Given a worker is running for a conversation
    When the worker streams an unusually large volume to a single destination
    Then the flow to that destination is throttled
    And the flow is flagged for an operator to review
    And other destinations for that worker are not slowed

  Scenario: A burst of new connections to a rare host is throttled
    Given a worker is running for a conversation
    When the worker opens many new connections to a rarely-seen host in a short window
    Then the new-connection rate to that host is throttled
    And the burst is flagged and attributed to the worker's conversation

  # ===========================================================================
  # Rung 3 — always-on FQDN floor
  # ===========================================================================

  Scenario: Structural destinations stay reachable regardless of allow-list
    Given the operator FQDN floor includes GitHub, the AI gateway, and the control plane
    And a project has not configured a Langy egress allow-list
    When a worker performs its GitHub, gateway, or control-plane traffic
    Then those connections are allowed by the floor
    And the worker's legitimate PR / model / API work is unaffected

  Scenario: The floor composes with, and is not widened by, an empty customer list
    Given a project has not configured a Langy egress allow-list
    When a worker connects to a host outside the operator FQDN floor
    Then the floor does not deny it
    But it remains monitor-only rather than allow-listed

  # ===========================================================================
  # Rung 3 limitation — cooperative L7, honestly bounded
  # ===========================================================================

  Scenario: A direct-IP bypass of the adapter is still observed
    Given a worker is running under an enforced allow-list
    When the worker ignores its proxy and connects directly to an external IP on 443
    Then the adapter cannot block that cooperative bypass in the stock pod
    But the direct connection is still observed at the flow level and flagged
    And an operator who needs it blocked can enable the Cilium FQDN policy or the per-worker netns floor

  # ===========================================================================
  # Rung 4 — the legacy path is gone
  # ===========================================================================

  Scenario: The worker has no unproxied egress path once enforcement lands
    Given the egress adapter is the sole egress path for workers
    When a worker's tools make outbound requests
    Then all egress is observed and enforced at the adapter
    And the previous direct worker-to-internet path is no longer available

  # ===========================================================================
  # Safe-by-default posture
  # ===========================================================================

  Scenario: An install that configures nothing upgrades into watching, not blocking
    Given an existing install with no per-project allow-lists and the FQDN floor off
    When workers make their normal outbound requests after this change ships
    Then no new outbound request is blocked by default
    And every outbound request is monitored and attributable
