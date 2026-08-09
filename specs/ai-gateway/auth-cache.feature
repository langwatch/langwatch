Feature: Gateway auth cache — hot path is zero RTT after first hit

  # All scenarios in this file describe auth-cache behaviour in the Go
  # gateway data plane (services/aigateway/). Three-tier cache, JWT
  # refresh, stale-on-failure fallback — none of this lives in the
  # TypeScript control plane. The parity check only scans TS test roots,
  # so these are aspirational at this layer; verified end-to-end via
  # Go integration tests in services/aigateway/.

  The gateway is in the hot path of every LLM request. Auth cannot add
  measurable latency. We keep a three-tier cache (in-mem LRU → optional
  Redis L2 → background refresh + optional bootstrap-pull) and verify the
  JWT locally on every request (no control-plane round trip post-warmup).

  See contract.md §4.1 (resolve-key), §4.2 (config fetch), §4.3 (changes
  long-poll), §9 (cache strategy).

  Background:
    Given the gateway is configured with LW_GATEWAY_INTERNAL_SECRET
    And the control plane is reachable at "http://langwatch:5560"

  Rule: First request for a new VK pays the resolve-key round trip

    @integration @unimplemented
    Scenario: cold cache -> control plane -> cached for next request
      Given the auth cache is empty
      And the control plane will sign a JWT for "vk-lw-01HZX9K3M000000000000001" with revision 42
      When I send an authenticated request with that key
      Then the gateway calls POST /internal/gateway/resolve-key exactly once
      And the request is authorized
      And on the next request with the same key, the gateway makes zero control-plane calls
      And the hot-path auth step completes in less than 200 microseconds

  Rule: Cached JWT survives control-plane outage until it expires

    @integration @unimplemented
    Scenario: control plane down, cached JWT still valid -> request succeeds
      Given the cache holds a JWT with exp = now + 10 minutes for "vk-lw-..."
      And the control plane returns 503 on all endpoints
      When I send a request with that VK
      Then the gateway verifies the JWT locally (signature + exp)
      And the request proceeds to dispatch
      And no /resolve-key or /config call is made
      And /readyz still reports control_plane_reachable as degraded but /healthz is 200

    @integration @unimplemented
    Scenario: control plane down and cached JWT near expiry -> proactive refresh bumps soft expiry
      Given the cache holds a JWT with exp = now + 30 seconds
      And the control plane is unreachable
      When I send a request with that VK
      Then the gateway verifies the JWT locally (still valid)
      And the request succeeds
      And a proactive refresh is attempted in background
      And the failure is classified as transport (not rejection)
      And the entry's soft expiry is bumped by 5 minutes (operator visibility, no user effect)
      And the failure is logged with level=warn

  Rule: Cached JWT serves stale-while-error past natural expiry on transport failure
    The gateway must not hard-reject traffic just because the control plane is
    briefly unreachable. When a cached entry crosses its JWT exp AND the
    control-plane refresh fails for transport reasons (network error, dial
    timeout, 5xx, connection refused, malformed/unparseable response), the
    gateway extends the entry's soft expiry by a short grace window (default
    5 minutes) and continues serving, up to a hard expiry cap (default 30
    minutes past the original JWT exp). On any auth-class rejection
    (401/403/404 from /resolve-key), the entry is evicted immediately and
    the request is rejected — bad credentials must never get a grace window.

    @unit @unimplemented
    Scenario Outline: expired entry + transport failure -> serve stale, bump soft
      Given the cache holds an entry whose JWT expired 30 seconds ago
      And the control plane is failing with <failure>
      When I send a request with that VK
      Then the gateway serves the cached bundle
      And the entry's soft expiry is bumped by 5 minutes
      And the entry's hard expiry cap is unchanged
      And the failure is logged with level=warn

      Examples:
        | failure                            |
        | dial timeout                       |
        | read timeout mid-response          |
        | 500 Internal Server Error          |
        | 502 Bad Gateway                    |
        | 503 Service Unavailable            |
        | 504 Gateway Timeout                |
        | TCP connection refused             |
        | DNS resolution error               |
        | unparseable JWT response body      |
        | JWT signature verification failure |

    @unit @unimplemented
    Scenario Outline: expired entry + auth rejection -> evict and reject (no grace window)
      Given the cache holds an entry whose JWT expired 30 seconds ago
      And the control plane returns <status>
      When I send a request with that VK
      Then the gateway evicts the cached entry
      And the request is rejected with error.type "<error_type>"
      And the entry's soft expiry is NOT bumped

      Examples:
        | status                | error_type            |
        | 401 Unauthorized      | invalid_api_key       |
        | 404 Not Found         | invalid_api_key       |
        | 403 Forbidden         | virtual_key_revoked   |

  Rule: A config fetch failure never manufactures a "no provider configured" answer
    resolve-key authenticates the key; the /config fetch carries the org's
    provider credentials. If the config fetch fails, a bundle with zero
    credentials must never be cached or served: dispatch would answer the
    terminal no_provider_configured 400 — telling an org with perfectly good
    keys to go add a provider API key — and the poisoned bundle would keep
    that answer alive until expiry, on every node sharing the cache.

    @unit
    Scenario: config fetch fails on a cold miss -> retryable error, nothing cached
      Given the control plane resolves the key successfully
      But the config fetch fails with a transport error
      When I send a request with that VK
      Then the request is rejected with error.type "auth_upstream_unavailable" (503, retryable)
      And no bundle is cached in L1 or L2
      And the next request retries the control plane and succeeds once it recovers

    @unit
    Scenario: config fetch succeeds with zero credentials -> the real no-provider answer stands
      Given the control plane resolves the key successfully
      And the config fetch succeeds carrying an empty credential list
      When I send a request with that VK
      Then the bundle is cached and served with zero credentials
      And dispatch answers no_provider_configured (the org genuinely has no provider key)

    @unit
    Scenario: config fetch fails during a stale-entry refresh -> stale credentials keep serving
      Given the cache holds a soft-expired entry whose bundle carries known-good credentials
      And the control plane resolves the key successfully
      But the config fetch fails with a transport error
      When I send a request with that VK
      Then the stale bundle with its credentials is served
      And its soft expiry is bumped, transport-failure style
      And the config-less fresh bundle is not cached

    @unit
    Scenario: config fetch fails during a proactive background refresh -> the healthy entry survives
      Given the cache holds a fresh entry near its soft expiry with known-good credentials
      And the control plane resolves the key successfully
      But the config fetch fails with a transport error
      When the proactive background refresh runs
      Then the existing entry keeps serving its credentials
      And the config-less fresh bundle does not replace it

    @unit
    Scenario: a negative hard grace disables stale-while-error
      # Zero means "unset" and takes the 6h default, matching every other
      # knob here, so the opt-out is a negative value: it places the hard cap
      # before the JWT exp, leaving nothing that could be served stale.
      Given LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS is negative
      And the cache holds an entry past its JWT exp
      And the control plane is unreachable
      When I send a request with that VK
      Then no stale bundle is served
      And the request is rejected with error.type "auth_upstream_unavailable"

    @unit @unimplemented
    Scenario: hard expiry cap stops the stale-while-error chain
      Given the cache holds an entry stale-extended past the LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS cap (default 21600, 6h)
      And the control plane is still unreachable
      When I send a request with that VK
      Then the gateway evicts the cached entry
      And the request is rejected with error.type "auth_upstream_unavailable"
      And no further soft-bump is applied
      And the failure is logged with level=error (operator must investigate)

    @unit @unimplemented
    Scenario: successful refresh resets soft expiry to fresh JWT exp
      Given the cache holds an entry stale-extended by 10 minutes past its JWT exp
      And the control plane recovers and signs a fresh JWT
      When I send a request with that VK
      Then the cache entry is replaced with the fresh bundle
      And the soft expiry tracks the new JWT's exp
      And the hard expiry cap is recomputed relative to the new bundle

    @unit @unimplemented
    Scenario: background refresh near soft-expiry on transport failure bumps the entry
      Given the cache holds an entry whose JWT is 30 seconds from expiring
      And the control plane is unreachable
      When the near-expiry background refresh fires
      Then the entry's soft expiry is bumped by 5 minutes
      And the failure is logged with level=warn

    @unit @unimplemented
    Scenario: background refresh near soft-expiry on auth rejection evicts the entry
      Given the cache holds an entry whose JWT is 30 seconds from expiring
      And the control plane returns 403 Forbidden
      When the near-expiry background refresh fires
      Then the entry is evicted from L1 (and L2 if configured)
      And the next request with that VK calls /resolve-key fresh and is rejected

  Rule: Short-lived JWT is refreshed before expiry

    @unit @unimplemented
    Scenario: JWT at 10 minutes triggers async refresh
      Given the cache holds a JWT with exp = now + 5 minutes (TTL 15m, refresh threshold 5m)
      When I send a request with that VK
      Then the gateway serves from cache immediately (zero added latency)
      And a background goroutine calls /resolve-key for a fresh JWT
      And the replacement bundle is stored in L1 (and L2 if configured)

  Rule: Revocation propagates within 60 seconds via long-poll /changes

    @integration @unimplemented
    Scenario: revoked VK stops working within 60s without restart
      Given "vk-lw-01HZX9K3M000000000000002" is cached with a valid JWT
      When the platform revokes that VK
      Then the next /changes long-poll returns an event {vk_id, kind: "vk_revoked"}
      And the gateway invalidates every L1 entry matching that vk_id
      And the next request using that key calls /resolve-key again
      And /resolve-key responds 403
      And the gateway returns 401 with error.type "virtual_key_revoked"
      And the whole propagation completes in under 60 seconds

    @integration @unimplemented
    Scenario: config update propagates via /changes without dropping traffic
      Given a cached bundle for vk with revision 42
      When the platform updates the VK config to revision 43
      Then the next /changes poll returns {vk_id, kind: "vk_config_updated", revision: 43}
      And the gateway fetches GET /internal/gateway/config/vk with If-None-Match:"42"
      And the response is 200 with the new config
      And the cache entry is updated in place
      And in-flight requests already dispatched are unaffected

    @integration @unimplemented
    Scenario: /changes long-poll survives a 25s no-op cycle
      Given no VK mutations happen during a 25s window
      When the /changes poll runs
      Then the control plane returns 204 No Content
      And the gateway immediately starts the next poll
      And the gateway never sleeps; the long-poll is the only wait

  Rule: A routing-policy or cache-rule edit propagates through the change feed
    Routing policies and cache rules are org-scoped artifacts that the
    materialiser folds into every bundle it builds, and a bundle carries no
    id to join either of them back on. So the organization is the finest
    invalidation key available, and both kinds evict every cached bundle in
    the polled organization, exactly like a budget change that carries no
    project. Without this the only thing that reaches a running gateway is
    the config TTL, which is a safety net rather than a propagation path.

    @unit
    Scenario: an edited routing policy evicts the organization's cached bundles
      Given bundles for two organizations are cached
      When the change feed for the first organization reports a routing-policy edit
      Then every cached bundle belonging to that organization is evicted
      And the other organization's bundles stay cached
      And the next request for an evicted key re-resolves against the fresh policy

    @unit
    Scenario: a deleted routing policy evicts the organization's cached bundles
      Given bundles for two organizations are cached
      When the change feed for the first organization reports a routing-policy deletion
      Then every cached bundle belonging to that organization is evicted
      And the other organization's bundles stay cached

    @unit
    Scenario: a cache-rule mutation evicts the organization's cached bundles
      Given bundles for two organizations are cached
      When the change feed for the first organization reports a cache rule created, updated, or deleted
      Then every cached bundle belonging to that organization is evicted
      And the other organization's bundles stay cached

    # The control plane may emit a kind this build predates, and doing
    # nothing about it is usually right. Doing nothing SILENTLY is not:
    # that is how the cache-rule kinds above stayed unhandled from the day
    # the control plane started emitting them.
    @unit @regression
    Scenario: A change kind this build does not act on is reported, not dropped
      Given a bundle is cached
      When the change feed reports a kind this gateway has no case for
      Then nothing is evicted
      And the gateway reports the unhandled kind by name

    @unit
    Scenario: the evict log names the change kind that caused it
      Given bundles are cached for an organization
      When the change feed reports any kind the gateway acts on
      Then the eviction is logged under that kind's own name
      And a deletion is never reported as an update

    # The control-plane half of the same path: an edit that never reaches
    # the feed can never be polled off it.
    @integration
    Scenario: editing a routing policy appends one change event and bumps its keys
      Given a routing policy that two virtual keys reference and one does not
      When an admin edits the policy
      Then exactly one ROUTING_POLICY_UPDATED event is appended for the organization
      And the revision of both referencing keys is bumped
      And the revision of the unrelated key is unchanged
      And an edit that is rejected writes neither the policy change nor the event

    @integration
    Scenario: deleting a routing policy releases the keys that pointed at it
      Given a routing policy that a virtual key references in policy routing mode
      When an admin deletes the policy
      Then exactly one ROUTING_POLICY_DELETED event is appended for the organization
      And the key no longer points at the deleted policy
      And the key's routing mode moves off policy routing, so it is never left naming a policy that is gone
      And the key's revision is bumped

    @integration
    Scenario: creating a policy or swapping the default emits nothing
      Given an organization with an existing default routing policy
      When an admin creates another policy, then makes it the default
      Then no change event is appended
      And already-issued keys keep the policy they were issued against

  Rule: Invalidation reaches every cache tier, not just the node that saw the event
    L1 is one node's own copy; L2 is the copy every node shares. Dropping an
    entry from L1 alone is undone by the very next request, which finds the
    invalidated bundle in the shared tier and puts it straight back, so the
    mutation the event announced does not take effect until the config TTL
    expires. The rehydrate also has to carry the config's real age: stamping
    it as freshly fetched restarts the staleness clock, so an entry most of
    the way through its TTL comes back with a whole new one and staleness can
    reach twice the TTL. This holds for every change kind, not only the
    newest ones.

    @unit
    Scenario: a change event drops the entry from the shared cache tier too
      Given a bundle is cached in both the node's own tier and the shared tier
      When the change feed reports a mutation that invalidates it
      Then the bundle is gone from both tiers
      And the next request for that key re-resolves against the control plane
      And bundles for other organizations stay in both tiers

    @unit
    Scenario: a shared tier that cannot be reached does not hold up the local eviction
      Given a bundle is cached in both tiers
      And the shared tier is unreachable
      When the change feed reports a mutation that invalidates it
      Then the entry is still evicted from the node's own tier
      And the failed deletion is reported, since that copy stays stale until the config TTL

    @unit
    Scenario: a shared-tier batch that fails does not take the rest of the eviction with it
      Given an organization with more cached bundles than fit in one deletion batch
      And the shared tier drops one batch and accepts the others
      When the change feed reports a mutation that invalidates the organization
      Then the entries in the batches that were accepted are gone from the shared tier
      And the eviction is reported once with how many entries were left behind

    @unit
    Scenario: a bundle past its hard cap is never served from the shared tier
      Given the shared tier hands back a bundle whose hard expiry has passed
      When a node whose own tier is empty serves a request with that key
      Then the expired bundle is not served
      And the request resolves against the control plane instead

    @unit
    Scenario: rehydrating from the shared tier keeps the config's real age
      Given the shared tier holds a bundle whose config was fetched longer ago than the config TTL
      When a node whose own tier is empty serves a request with that key
      Then the cached bundle is served
      And its config is refreshed rather than treated as freshly fetched
      And a shared entry whose config is still inside the TTL is not refetched

  Rule: L2 Redis cache warms new gateway nodes

    @integration @unimplemented
    Scenario: new gateway pod reads a cached bundle from Redis instead of calling /resolve-key
      Given Redis is configured and pod A has cached VK "vk-lw-..." for 3 minutes
      When pod B receives its first request with that VK
      Then pod B finds the bundle in Redis (L2 hit)
      And pod B populates its own L1
      And pod B does NOT call /resolve-key
      And the Redis value expires at the JWT's exp

  Rule: Bootstrap-pull enables gateway to serve when control plane is cold

    @integration @unimplemented
    Scenario: enterprise bootstrap-all pulls every non-revoked VK on startup
      Given GATEWAY_CACHE_BOOTSTRAP_ALL_KEYS=true
      And the control plane has 250 active VKs
      When the gateway starts
      Then the gateway calls GET /internal/gateway/bootstrap (paginated)
      And every page of non-revoked VK JWTs is warmed into L1
      And /startupz returns 200 after the last page is consumed
      And the gateway can serve requests even if the control plane goes offline immediately after

  Rule: L1 key material is never persisted to disk

    @unit @unimplemented
    Scenario: cache keys are SHA-256 hashes, not raw VK bytes
      Given a VK "vk-lw-01HZX9K3M000000000000001" is resolved
      When I inspect the cache keyset
      Then the key is the 64-char hex SHA-256 of the raw VK
      And the raw VK value is not stored anywhere in the cache entries
