Feature: Gateway auth cache — hot path is zero RTT after first hit

  # All scenarios in this file describe auth-cache behaviour in the Go
  # gateway data plane (services/aigateway/). One cache tier, JWT
  # refresh, stale-on-failure fallback — none of this lives in the
  # TypeScript control plane. The parity check only scans TS test roots,
  # so these are aspirational at this layer; verified end-to-end via
  # Go integration tests in services/aigateway/.

  The gateway is in the hot path of every LLM request. Auth cannot add
  measurable latency. Each pod keeps one in-memory LRU, refreshed in the
  background, and verifies the JWT locally on every request (no
  control-plane round trip post-warmup). The cache is per pod on purpose:
  a shared tier buys a warm start that a rolling deploy already pays for
  anyway, and costs an invalidation path that has to reach it.

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
    that answer alive until it expires.

    @unit
    Scenario: config fetch fails on a cold miss -> retryable error, nothing cached
      Given the control plane resolves the key successfully
      But the config fetch fails with a transport error
      When I send a request with that VK
      Then the request is rejected with error.type "auth_upstream_unavailable" (503, retryable)
      And no bundle is cached
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
      Then the entry is evicted from the cache
      And the next request with that VK calls /resolve-key fresh and is rejected

  Rule: Short-lived JWT is refreshed before expiry

    @unit @unimplemented
    Scenario: JWT at 10 minutes triggers async refresh
      Given the cache holds a JWT with exp = now + 5 minutes (TTL 15m, refresh threshold 5m)
      When I send a request with that VK
      Then the gateway serves from cache immediately (zero added latency)
      And a background goroutine calls /resolve-key for a fresh JWT
      And the replacement bundle is stored in the cache

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

    @unit
    Scenario: every kind the control plane can emit is acted on or ignored on purpose
      Given the kinds the control plane can emit are declared in one place
      When the change feed reports each of them in turn
      Then none of them is reported as a kind this build does not recognize
      And a kind added upstream fails this check rather than becoming a warning in production

    # The control plane may emit a kind this build predates, and doing
    # nothing about it is usually right. Doing nothing SILENTLY is not:
    # that is how the cache-rule kinds above stayed unhandled from the day
    # the control plane started emitting them. A kind this build ignores on
    # purpose is named in its own case, so a routine event never arrives
    # looking like an incident.
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

  Rule: The config safety net revalidates, it does not re-download
    The change feed is how a config edit reaches a running gateway. The config
    TTL is the safety net under it, for the mutations that emit no event, and a
    safety net fires mostly when nothing is wrong: almost every time it runs,
    the key is exactly as it was. So it asks rather than downloads. The control
    plane already versions each key's config with an ETag it derives from the
    key's revision, which every mutation bumps, and answers 304 to a matching
    If-None-Match. The gateway keeps that ETag beside the cached bundle and
    offers it back, so an unchanged key costs a revision lookup instead of a
    whole bundle materialized, serialized and parsed, on every cached key, every
    TTL, on every pod.

    A confirmation is worth as much as a download: the config was checked
    against the control plane and found current, so it restarts the staleness
    clock. What it must never do is answer with less than it was asked for. A
    304 to a request that offered no ETag confirms nothing, and an error or an
    unreadable answer leaves the cached config in place rather than replacing it
    with an empty one.

    @unit
    Scenario: the staleness refresh revalidates instead of re-downloading
      Given a cached bundle whose config the control plane served with a version token
      When the config TTL elapses and the safety net runs
      Then the refresh offers that token back to the control plane
      And a key nobody changed is confirmed rather than sent again
      And the confirmed entry keeps serving its credentials with its staleness clock restarted
      And a key that did change comes back with the new config and the new token, which the next refresh offers in turn
      And a response that carried no token leaves the next refresh unconditional
      And a control plane that changed the config without changing the token keeps confirming a bundle that is no longer current, which is why the token covers the provider rows and not only the key

    @unit
    Scenario: a refresh the control plane cannot answer leaves the cached config serving
      Given a cached bundle whose config has crossed the TTL
      And the control plane cannot answer the refresh
      When the safety net runs
      Then the bundle keeps serving the credentials it already had
      And the failed attempt is reported
      And the next attempt waits a full TTL rather than retrying on every request

    @unit
    Scenario: an answer the gateway cannot read is a failed refresh, not an empty config
      Given the control plane answers the refresh with a body the gateway cannot parse
      When the safety net runs
      Then the answer is treated as a failure
      And no config is taken from it, so a working bundle is never replaced by an empty one
      And no version token is stored from it, so the next refresh does not revalidate against one

  Rule: The grace window moves the hard cap, not the bundle's own expiry
    LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS sets how far past its JWT expiry
    a cached bundle may keep serving while the control plane is unreachable,
    and a negative value opts out by putting that cap BEFORE the expiry. What
    it must never do is decide whether a bundle inside its own expiry is
    servable: an unexpired bundle serves from cache wherever the cap sits, and
    an expired one goes to the control plane first. Reading the cap before the
    expiry gets the negative setting backwards and throws away credentials
    that are perfectly good.

    @unit
    Scenario: the grace window moves the hard cap, not the bundle's own expiry
      Given a cached bundle and a configured grace window
      When a request is answered from the cache
      Then a bundle inside its own expiry is served without consulting the control plane, whether the window is positive, zero or negative
      And a bundle past its own expiry goes to the control plane before it serves

  Rule: A key's own expiration date bounds the cache, and grace never crosses it
    Stale-while-error covers a control plane the gateway cannot reach. An
    expiration date is a different thing: the control plane already published
    it, on the token itself, so the gateway can enforce it alone and needs no
    round trip to know the key has stopped. Both cache deadlines are therefore
    capped at that instant, and a request that arrives after it is refused with
    the key's own error rather than served from grace or answered with a
    retryable upstream failure.

    Revoked and disabled keys keep the full grace window on purpose. A
    revocation happens after the token was minted and cannot be predicted; a
    date can. The operator opt-out for both is the same negative
    LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS.

    @unit
    Scenario: the token carries the key's expiration date to the gateway
      Given a token minted for a key that expires in five minutes
      When the gateway reads its claims
      Then the resolved bundle carries that expiration date
      And a token with no such claim, or a null one, describes a key that never expires

    @unit
    Scenario: the hard cap never outlives the key's expiration date
      Given a key that expires in five minutes
      When its bundle is cached
      Then the entry's hard cap is the key's expiration date, not the token expiry plus the grace window
      And a bundle for a key with no expiration date keeps the deadlines it always had

    @unit
    Scenario: an outage across the expiration date fails closed
      Given a cached entry for a key whose expiration date has passed
      And the control plane is unreachable
      When I send a request with that key
      Then the request is rejected with error.type "virtual_key_expired"
      And the cached bundle is not served
      And the control plane is not called, because the date came with the token
      And the entry is evicted

    @unit
    Scenario: an outage before the expiration date still serves stale
      Given a cached entry past its token expiry for a key that expires in an hour
      And the control plane is unreachable
      When I send a request with that key
      Then the cached bundle is served
      And its soft expiry is bumped, transport-failure style

  Rule: A changed expiration date reaches the gateway on the config channel

    The date travels on two channels, because each covers what the other
    cannot. The token claim is the mint-time floor: it needs no control plane to
    be true, so a full outage still stops the key at the last date the gateway
    was told. The config response carries the date as well, and that is the
    update path: the config version token moves on every mutation, so a date an
    admin shortens or extends arrives on the next config revalidation, inside
    the config TTL, even while the change feed is unavailable.

    Both directions matter. Shortening a date has to take effect, or a key keeps
    calling providers after it ran out. Extending one has to take effect too, or
    a request at the old boundary is refused for a date the control plane has
    already moved.

    A response that carries no expiration field comes from a control plane older
    than the field. The gateway then keeps the date it holds. Reading an absent
    field as "this key never expires" would lift the cap off a key whose own
    token says it expires.

    @integration
    Scenario: the config endpoint carries the key's expiration date
      Given a key that expires on a date, and a key that never expires
      When the gateway fetches each key's config
      Then the first carries its date in unix seconds
      And the second carries an explicit null, which is not the same answer as no field at all

    @integration
    Scenario: changing only the date moves the config version token
      Given a key the gateway holds config for
      When an administrator changes only its expiration date
      Then the config version token changes
      And the next revalidation answers with the config and the new date instead of confirming the old one

    @unit
    Scenario: a shortened date is followed while the change feed is unavailable
      Given a cached key the gateway holds no expiration date for
      And the change feed is not wired
      When the config refresh answers with a date that has passed
      Then the next request with that key is rejected with error.type "virtual_key_expired"
      And the entry is evicted

    @unit
    Scenario: an extended date is followed the same way
      Given a cached key whose expiration date is a moment away
      When the config refresh answers with a later date before that moment
      Then a request after the old date serves normally
      And both cache deadlines move past the old date

    @unit
    Scenario: a config response with no expiration field keeps the date the gateway holds
      Given a cached key that expires in five minutes
      When the config refresh comes from a control plane that sends no expiration field
      Then the entry keeps the expiration date it had
      And its hard cap stays at that date

    @unit
    Scenario: the config wire tells a null date apart from a missing one
      Given a config response
      When the gateway decodes its expiration field
      Then a unix timestamp is the date the key stops
      And an explicit null is a key that never expires
      And a missing field says nothing about expiry, so the caller keeps what it holds

  Rule: Bootstrap-pull enables gateway to serve when control plane is cold

    # The flag is named the way contract.md §6 and §9 name it. Nothing reads
    # it yet, so the point of naming it here is that this file and the
    # contract agree on one name rather than two.
    @integration @unimplemented
    Scenario: enterprise bootstrap-all pulls every non-revoked VK on startup
      Given LW_GATEWAY_BOOTSTRAP_PULL=true
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
