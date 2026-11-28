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
    Scenario: a control plane that cannot answer resolve-key tells the client to retry
      Given the control plane is unreachable, answers 5xx, or sends a body the gateway cannot read
      When the gateway asks it to resolve a key
      Then the error is auth_upstream_unavailable and marked retryable

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
      And the eviction is logged at info, as the cache's ordinary lifecycle
      And the rejection is logged by the request as a platform fault (operator must investigate)

    @unit
    Scenario: an entry evicted at lookup for running out its lifetime logs at info
      Given the cache holds an entry past its hard cap, or past the key's expiration date
      When I send a request with that VK
      Then the gateway evicts the cached entry
      And the eviction is logged at info, not error

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

  Rule: A budget update refreshes the cached bundle without holding a request
    Every debit emits BUDGET_UPDATED, and a project with a blocking budget emits
    one per request. Evicting on it put a resolve-key and a config fetch (about
    60 ms locally) in front of most requests of a busy project. The cached
    bundle keeps serving instead, and the next request through the key starts
    one background refresh. Requests that arrive while it runs are judged on the
    spend the bundle already had, which stays inside the documented overshoot.
    BUDGET_CREATED and BUDGET_DELETED still evict.

    @unit @regression
    Scenario: a debit's budget update does not hold the next request
      Given the cache holds a key of project "proj-1"
      And the change feed reports a budget update for "proj-1"
      And the control plane is slow to answer
      When I send a request with that VK
      Then it is served from the cached bundle without waiting on the control plane
      And one background refresh of the key starts

    @unit
    Scenario: the background refresh replaces the bundle with the new spend
      Given a budget update started a background refresh of a key
      When the control plane answers it with the new spend
      Then the cached bundle carries the new spend
      And the next request asks the control plane nothing

    @unit
    Scenario: a key the refresh finds past its limit is refused on the next request
      Given a key with a blocking project budget
      And a debit pushed the project past its limit
      When the change feed reports the budget update
      Then the request that starts the refresh is judged on the spend it had
      And the request after the refresh lands is refused with budget_exceeded

    @unit
    Scenario: a budget update that lands while the refresh is running is not lost
      Given a background refresh of a key is waiting on the control plane
      When another budget update for its project arrives
      Then the bundle the refresh stores is marked for another refresh

    @unit
    Scenario: a budget update without a project marks the organization's keys
      Given the cache holds keys of two organizations
      When the change feed reports a budget update with no project for one of them
      Then that organization's keys are marked for refresh and none are evicted
      And the other organization's keys are untouched

    @unit
    Scenario: a budget refresh the control plane cannot answer keeps the key serving
      Given a budget update started a background refresh of a key
      When the control plane cannot answer it
      Then the cached bundle keeps serving
      And the refresh is retried after a pause rather than on every request

  Rule: A change-feed eviction keeps the last known config as an outage fallback
    A budget create or delete, a routing or cache-rule change and a provider
    change evict cached keys, and the next request pays a cold config fetch.
    When that fetch times out or the control plane answers 5xx, the key
    it was serving a minute ago must not start answering auth_upstream_unavailable.
    The evicted entry is kept aside and served again, for at most one hour after
    its config was last confirmed by the control plane. A definitive answer about
    the key itself (revoked, disabled, rotated, invalid, expired) never gets this
    fallback.

    @unit @regression
    Scenario: a key evicted by a budget change keeps serving when the refetch times out
      Given the cache holds a key with known-good credentials
      And the change feed reports a budget update for its project
      And the config fetch then times out
      When I send a request with that VK
      Then the last known credentials are served
      And a warning names the key and the failed refresh
      And the next request is served from the cache without waiting on the control plane
      And the next refresh asks for the config outright rather than revalidating it

    @unit
    Scenario: the fallback recovers as soon as the control plane answers
      Given a key is being served from its last known config after a failed refetch
      When the control plane answers the next refresh
      Then the fresh config replaces the last known one

    @unit
    Scenario: a not-modified answer counts as a confirmation of the last known config
      Given the cache holds a key whose config was last downloaded more than one hour ago
      And the control plane has since answered a revalidation with 304 Not Modified
      When the change feed evicts the key and the refetch times out
      Then the last known config is served
      And it may be served for up to one hour after that 304

    @unit
    Scenario: the last known config expires one hour after it was last confirmed
      Given the cache evicted a key whose config was last confirmed more than one hour ago
      And the config fetch fails with a transport error
      When I send a request with that VK
      Then the request is rejected with error.type "auth_upstream_unavailable" (503, retryable)
      And an entry that crosses the one hour mark while the refetch is running is not served either

    @unit
    Scenario: the fallback never outlives the key's own expiration date
      Given the cache evicted a key after a budget update
      And resolve-key answers with a token carrying the key's expiration date
      But the config fetch times out
      When I send a request with that VK
      Then the last known config is served under the fresh token
      And it stops being served at the key's expiration date
      And a key whose date has already passed is refused with virtual_key_expired

    @unit
    Scenario: revoking, disabling or rotating a key leaves no fallback behind
      Given the cache holds a key with known-good credentials
      When the change feed reports that key revoked, disabled or rotated
      And the control plane is then unreachable
      Then the request is rejected rather than served from the last known config

    @unit
    Scenario: a definitive rejection from the control plane is never overridden by the fallback
      Given the cache evicted a key after a budget update
      When the control plane answers the refetch that the key is invalid, or the config fetch finds it deleted (404)
      Then the request is rejected with that answer
      And the last known config is discarded

    @unit
    Scenario: the fallback never serves a rotated old secret past its grace
      Given the cache evicted a key presented with its old secret after a rotation
      And the old secret's grace ended while the entry was held as the last known config
      When the control plane is unreachable on the refetch
      Then the request is rejected rather than served from the last known config
      And the last known config is discarded

  Rule: Short-lived JWT is refreshed before expiry

    @unit @unimplemented
    Scenario: JWT at 10 minutes triggers async refresh
      Given the cache holds a JWT with exp = now + 5 minutes (TTL 15m, refresh threshold 5m)
      When I send a request with that VK
      Then the gateway serves from cache immediately (zero added latency)
      And a background goroutine calls /resolve-key for a fresh JWT
      And the replacement bundle is stored in the cache

  Rule: A revoked key is refused from every cache tier, even with the control plane down

    # The change feed delivers VK_REVOKED and VK_DISABLED in one long poll. The
    # gateway records each in a revocation list kept apart from the key cache,
    # so no stale-serve window or cache eviction expires it. A denied key is
    # refused locally, without a control-plane call. VK_ENABLED lifts a denial
    # at once; otherwise one background recheck per key per interval (30 s,
    # shared by concurrent requests) lifts it when the control plane confirms
    # the key. VK_ROTATED is not a denial: the old secret stays valid through
    # its grace period.

    @unit
    Scenario: concurrent requests wait for the fail closed key re-check
      Given fail closed is set and the change feed is silent past the limit
      And the control plane answers resolve-key slowly
      When many requests present the same cached key at once
      Then one key re-check runs and every request waits for it and is served

    @unit
    Scenario: a fail closed key re-check outlives the request that started it
      Given fail closed is set and the change feed is silent past the limit
      When the client that started the key re-check disconnects
      Then the re-check finishes on its own and the next request is served without a new check

    @unit
    Scenario: concurrent requests never serve a key after its revocation
      Given many requests present a cached key at once
      When the change feed revokes the key and the control plane goes down
      Then no request that began after the revocation is served

    @unit
    Scenario: a held session ends on a denied key while the control plane is down
      Given a voice session holds a key the change feed revoked
      When its key watch re-reads the key during an outage
      Then the key reads as revoked and the session ends

    @unit
    Scenario: a denial that lands during a confirmation is kept
      Given a key denied once
      When a second denial lands while a confirmation that began between them is checked
      Then the second denial stays on the revocation list

    @unit
    Scenario: re-enabling a key forgets only its own denied credentials
      Given two disabled keys with denied credentials
      When one key is re-enabled
      Then only that key's credentials leave the denied list

    @unit
    Scenario: a rotation keeps the old secret valid
      Given a cached key whose old secret is still in its grace period
      When the change feed reports the key rotated
      Then a resolve with the old secret still serves the key

    @unit
    Scenario: the old secret ends when the control plane refuses it after the grace
      Given a cached old secret past its JWT expiry after a rotation
      When the control plane refuses the old secret at the end of the grace
      Then the request with the old secret gets invalid_api_key
      And the cached copy is gone

    @unit
    Scenario: fail closed refuses a key that expired during its re-check
      Given a cached key past the fail-closed limit
      When the re-check confirms the key but its expiry passes before the config fetch fails
      Then the request gets virtual_key_expired

    @unit
    Scenario: fail closed does not serve cached config past its hard cap
      Given a cached key past the fail-closed limit and past its hard cap
      When the re-check confirms the key and the config fetch fails
      Then the request gets a retryable config error, not the cached config

    @unit
    Scenario: a revoked key is refused while the control plane is down
      Given a cached key past its JWT expiry
      When the change feed revokes it
      And the control plane stops answering
      Then every request with that key gets virtual_key_revoked, not a retryable error

    @unit
    Scenario: a disabled key is refused while the control plane is down
      Given a cached key
      When the change feed disables it
      And the control plane stops answering
      Then every request with that key gets virtual_key_disabled, not a retryable error

    @unit
    Scenario: a resolve that started before the revocation cannot put the key back
      Given a resolve-key call is in flight for a key
      When the change feed revokes the key before that call returns
      Then the request is refused with virtual_key_revoked
      And nothing is left in the cache for that key

    @unit
    Scenario: a flood of credentials on a denied key keeps the denied list bounded
      Given the change feed revoked a cached key
      When thousands of different credentials of that key are refused
      Then the key keeps at most 8 denied credentials
      And the first denied credential is still refused

    @unit
    Scenario: a change the in-flight guard cannot track reaches every fetch in flight
      Given resolve-key calls are in flight
      When an evict-all event lands or more keys change than the guard tracks
      Then no answer from those calls is cached
      And a fetch that starts after the change is cached

    @unit
    Scenario: a key confirmed after its re-enable serves again
      Given the change feed disabled a key and then enabled it
      When the control plane confirms the key
      Then the request serves

    @unit
    Scenario: a key re-enabled and re-confirmed keeps serving through a later outage
      Given the change feed disabled a cached key and then enabled it
      And the control plane confirmed the key again
      When the control plane stops answering
      Then the key serves, not virtual_key_disabled

    @unit
    Scenario: a denied key is refused locally with at most one recheck per interval
      Given the change feed disabled a cached key
      When 1000 requests arrive with that key
      Then every request gets virtual_key_disabled
      And the control plane gets at most one call for that key in the interval

    @unit
    Scenario: a re-enable on the change feed lifts the denial at once
      Given the change feed disabled a cached key and the key was refused
      When the change feed enables the key
      Then the next request serves without waiting for a recheck

    @unit
    Scenario: the background recheck lifts the denial when the control plane confirms the key
      Given the change feed disabled a cached key
      And the re-enable event never arrived
      When the recheck interval has passed and the control plane confirms the key
      Then the denial is lifted and the key serves
      And a later outage does not answer the key with virtual_key_disabled

    @unit @regression
    Scenario: a denial that lands during a recheck is kept
      Given the change feed disabled a cached key and the recheck interval has passed
      When the change feed disables the key again while the recheck waits on the control plane
      Then the denial survives the recheck and the key stays refused

    @unit
    Scenario: a normal key keeps serving from cache within the grace window
      Given a cached key nobody revoked, past its JWT expiry
      When the control plane stops answering
      Then the key keeps serving inside the stale-while-error window

    @unit
    Scenario: fail closed refuses a key nothing re-checked within the limit
      Given LW_GATEWAY_AUTH_CACHE_FAIL_CLOSED_AFTER_SECONDS is 60
      And a cached key last confirmed 2 minutes ago
      When the org's change feed answered within the last 60 seconds
      Then the key serves
      When the org's change feed has not answered for 2 minutes
      Then the key is refused with auth_upstream_unavailable

    @unit
    Scenario: an outage fallback after a fresh key check passes fail closed
      Given fail closed is on and the change feed has gone silent
      And a key whose last known entry was confirmed 2 minutes ago
      When resolve-key confirms the key but the config fetch times out
      Then the last known config serves under the fresh key check
      And the restored entry carries the fresh key check time

    @unit
    Scenario: fail closed re-checks the key before it refuses
      Given fail closed is on and the change feed has gone silent
      And a cached key whose last key check is older than the limit
      When the control plane still answers key checks
      Then the key is checked once and served
      And the next request is served from the cache without another check

    @unit
    Scenario: fail closed paces its key re-checks during an outage
      Given fail closed is on and the control plane is down
      And a cached key whose last key check is older than the limit
      When many requests arrive within the re-check interval
      Then the gateway makes one key check and refuses them all

    @unit
    Scenario: a cache refresh keeps the pace of fail closed re-checks
      Given fail closed just re-checked a cached key with the control plane
      When a config refresh replaces the key's cache entry
      Then the next request inside the re-check interval does not re-check the key again

    @unit
    Scenario: fail closed keeps the cached config when only the config fetch fails
      Given fail closed is on and a cached key whose last key check is older than the limit
      And the control plane confirms the key but its config fetch fails
      When a request arrives
      Then the request is served with the cached config
      And no fail closed refusal is counted

    @unit
    Scenario: a stale config serve counts the refresh as the fail closed key check
      Given fail closed is on and the change feed has gone silent
      And a cached key whose last key check is older than the limit
      When the cache refresh confirms the key but its config fetch fails
      Then the request is served with the cached config
      And the key is checked once, not again for admission

    @unit
    Scenario: fail closed evicts a key its re-check rejects
      Given fail closed is on and a cached key whose last key check is older than the limit
      When the re-check answers that the key is revoked
      Then the request is refused as revoked
      And neither the cache nor the last-known store holds the key

    @unit
    Scenario: fail closed covers a key with no organization
      Given fail closed is on and the control plane is down
      And a cached key with no organization and no change feed
      When its last key check is older than the limit
      Then the gateway refuses it

    @unit
    Scenario: fail closed is off by default
      Given LW_GATEWAY_AUTH_CACHE_FAIL_CLOSED_AFTER_SECONDS is unset
      And a cached key last confirmed 3 hours ago with a silent change feed
      Then the key serves

  Rule: A disabled or revoked key is refused within a minute even while the change feed is down
    The change feed is how a disable or revoke reaches a replica. While an
    organization's feed is silent, a cached key nothing confirmed in the last
    60 seconds is checked with the control plane once more before it serves.
    A check that cannot reach the control plane keeps the outage grace above.

    @unit
    Scenario: with the change feed down, a disabled or revoked key is refused within a minute
      Given a cached key last confirmed 2 minutes ago whose organization's change feed has not answered for 2 minutes
      When the key is disabled or revoked on the control plane
      Then the next request checks the key once and is refused as disabled or revoked
      And the request after it is refused too

    @unit
    Scenario: with the change feed and the control plane down, a cached key keeps serving
      Given a cached key last confirmed 2 minutes ago whose organization's change feed has not answered for 2 minutes
      When the key check cannot reach the control plane
      Then the key serves inside the stale-while-error window

    @unit
    Scenario: a key the change feed vouches for is not re-checked
      Given a cached key last confirmed 2 minutes ago whose organization's change feed answered just now
      When a request arrives
      Then the key serves and the control plane is not asked

    @unit
    Scenario: a key confirmed within the limit serves from the cache with no key check
      Given a cached key confirmed just now and a silent change feed
      When a request arrives while the control plane is down
      Then the key serves and the control plane is not asked

    @unit
    Scenario: a negative key re-check limit turns the re-check off
      Given the key re-check limit is negative
      And a cached key last confirmed 2 minutes ago under a silent change feed
      Then the key serves and the control plane is not asked

    @unit
    Scenario: a disable or revoke that lands while the key check waits is refused
      Given a cached key last confirmed 2 minutes ago under a silent change feed
      When the key is revoked while its key check is still waiting on the control plane
      And the request stops waiting before the check answers
      Then the request is refused as revoked, not served from the cache

    @unit
    Scenario: a key whose expiration date passes while the key check waits is refused as expired
      Given a cached key last confirmed 2 minutes ago under a silent change feed
      When the key's expiration date passes while its key check is still waiting
      Then the request is refused as expired, not served from the cache

    @unit
    Scenario: a key check slower than the limit still serves its answer
      Given a key re-check limit shorter than the key check takes
      And a cached key last confirmed 2 minutes ago under a silent change feed
      When the control plane confirms the key
      Then the key serves

    @unit
    Scenario: a fetch begun before the control plane refused a key cannot cache it again
      Given a fetch for a cached key is in flight
      When a key check finds the key refused and evicts it
      Then the fetch's answer is not published to the cache

    @unit
    Scenario: a previous secret whose grace ends while the key check waits is refused
      Given a cached key presented with its previous secret, last confirmed 2 minutes ago under a silent change feed
      When the previous secret's grace ends while its key check is still waiting
      Then the request is refused as an invalid key, not served from the cache

    @unit
    Scenario: a refusal that lands as the key check's wait ends is refused
      Given a cached key last confirmed 2 minutes ago under a silent change feed
      When the key check refuses the key just as the request stops waiting
      Then the request is refused, not served from the cache

    @unit
    Scenario: a refusal recorded after a request read its cached key is refused
      Given a cached key last confirmed 2 minutes ago under a silent change feed
      And a request has read the key from the cache
      When another request's key check refuses the key and evicts it, leaving no check to wait on
      Then the first request is refused, not served from the cache

  Rule: A change-feed backlog refuses a key locally only for the state it ends in

    # A gateway that starts reads its organization's whole change history from
    # revision 0, and one that reconnects reads what it missed. Both arrive in
    # full pages of 500 events, so a disable and the enable that undoes it can
    # sit on different pages. A disable read from a full page still evicts the
    # key and voids every confirmation that began before it, but it refuses
    # no credential locally: the next request asks the control plane, and a
    # request whose answer it voided is asked again once. Once a page
    # shorter than a full one (or an empty poll) ends the backlog, every key
    # the backlog left disabled or revoked is refused locally, as a live event
    # would be. See issue #9754.

    @unit @regression
    Scenario: a key disabled and re-enabled on different pages of a replayed history keeps serving
      Given a gateway that just started and cached an active key
      And its organization's history disables the key on one full page and re-enables it on the next
      When the replay has read the page with the disable
      Then the key serves
      When the page with the enable fails to load
      Then the key keeps serving
      When the page with the enable arrives
      Then the key serves and the control plane going down does not refuse it

    @unit
    Scenario: a disable at the head of a replayed history is refused once the replay ends
      Given a gateway that cached an active key and is replaying its organization's history
      And the history disables the key, re-enables it on a later full page, and disables it again on the last page
      When the replay has read the first disable
      Then the key serves after the control plane confirms it
      When the replay reads the last page and the control plane stops answering
      Then the key gets virtual_key_disabled, not a retryable error

    @unit
    Scenario: a disable and an enable on the page that ends a replay never refuse the key between them
      Given a gateway that cached an active key
      When the change feed returns a short page that disables the key and then re-enables it
      Then the disable stays pending while the page is applied
      And the key serves, and the control plane going down afterwards does not refuse it

    @unit
    Scenario: a key cached before a reconnect is refused by a disable in the backlog it missed
      Given two cached keys and a change feed whose poll failed during an outage
      When the feed reconnects to a backlog of full pages
      And the backlog disables both keys and re-enables only the first on a later page
      Then the first key serves throughout the backlog
      And the second key is not served from its cached copy
      When the backlog ends and the control plane stops answering
      Then the second key gets virtual_key_disabled and the first key serves

    @unit @regression
    Scenario: an answer read before a pending denial is re-asked, not served
      Given a gateway replaying its organization's history in full pages
      And a resolve-key call for an active key is in flight
      When a backlog page disables the key before that call returns
      Then the gateway asks the control plane again instead of serving the old answer
      And the request gets the control plane's current answer
      When that second call fails
      Then the request gets a retryable auth_upstream_unavailable

    @unit
    Scenario: a disable that lands while the replay is in flight is refused
      Given a gateway replaying its organization's history in full pages
      And a resolve-key call for a key is in flight
      When a backlog page disables the key before that call returns
      And the control plane now refuses the key
      Then that request is asked again and refused with virtual_key_disabled
      And nothing is cached and the next request is refused by the control plane
      When the replay ends and the control plane stops answering
      Then the key gets virtual_key_disabled, not a retryable error

    @unit @regression
    Scenario: a held session survives an outage between backlog pages
      Given a voice session holds an active key
      And a backlog page recorded a pending disable of that key
      When its key watch re-reads the key while the control plane is down
      Then the read fails as an outage and the session is not ended as revoked

    @unit @regression
    Scenario: a stale denied-list entry never refuses a key whose denial is pending
      Given the denied list still maps a credential to its key after the key left the revocation list
      When a backlog page records a pending disable of that key
      Then the next request with that credential asks the control plane and serves

    @unit @regression
    Scenario: a key that leaves the revocation list leaves the credential index too
      Given a disabled key whose credential is refused locally
      When later denials push the key off the bounded revocation list
      Then the credential no longer maps to that key

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
    Scenario: a config refresh during a rotation grace never extends the old secret
      Given a cached old secret whose rotation grace ends in a moment
      When the config refresh answers with the key's own later expiration date
      And the control plane is unreachable when the grace ends
      Then the old secret stops being served at the grace end
      And it is refused as an invalid key, not as an expired one

    @unit
    Scenario: a config refresh that finds the key inactive evicts it
      Given a cached key that was disabled or revoked while the gateway missed the event
      When the config refresh answers that the key is no longer active
      Then the gateway drops every cached copy of the key
      And the next request asks the control plane and is refused

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

  Rule: A budget period that ends invalidates the spend the gateway is holding

    # The bundle carries each budget's spend for the period it was read in, and
    # the config version token is built from the key's revision and its
    # provider set. Neither of those moves when a period ends, so a conditional
    # revalidation confirms figures that describe a period that is over.
    #
    # For a budget that reached its limit, that leaves the key rejecting on
    # money it did not spend this period. What clears it is a BUDGET_UPDATED
    # event, and the only one that arrives without an admin touching something
    # is emitted by a debit — by a request that got through. The blocked key
    # cannot produce one itself.
    #
    # Eviction on that event is project-wide (org-wide when the event carries
    # no project), so a sibling key with traffic in the same project clears the
    # block for everyone within a poll cycle. The keys that stay stuck are the
    # ones whose project has no other traffic — a CI key, a scheduled job, a
    # single-key project — and they stay stuck until an admin edits something
    # or the gateway restarts. That is the case this Rule closes; it is not
    # closed by the change feed, which is why the boundary has to be a schedule
    # the gateway keeps on its own.

    @unit
    Scenario: a bundle knows when its spend figures stop describing the current period
      Given a config response carrying budgets that reset at different instants
      When the gateway decodes it
      Then the bundle is valid until the earliest of those instants
      And a budget with no limit does not shorten that, because it can never block
      And a budget the control plane sent no boundary for does not shorten it either

    @unit
    Scenario: the refresh at a period boundary asks for the config instead of confirming it
      Given a cached key whose budget period ended after its config was read
      When the next request arrives
      Then the config refresh carries no version token
      And the new period's spend replaces the old period's

    @unit
    Scenario: a period still running is revalidated the ordinary way
      Given a cached key whose budget is exhausted inside its own period
      And a config read within the staleness TTL
      When the next request arrives
      Then no config refresh is triggered
      And the request is judged against the spend the gateway holds

    @unit
    Scenario: a boundary that is already behind the gateway is asked about once
      Given a cached key carrying a budget boundary that never moves
      When request after request arrives
      Then only the first triggers a config re-read
      And the rest fall back to the ordinary staleness clock

    @unit
    Scenario: a refresh the control plane never answered leaves the period unresolved
      Given a cached key whose budget period ended after its config was read
      And a config refresh that fails to reach the control plane
      When a later request arrives
      Then the entry still holds the ended period's spend
      And the next refresh is unconditional too, so it cannot be confirmed as unchanged
      And the period counts as resolved only once an answer arrives

    @unit
    Scenario: a confirmation taken before the boundary does not count as reading past it
      Given a cached key whose config was confirmed unchanged inside its budget period
      When that period ends and the next request arrives
      Then the boundary still forces an unconditional re-read
      And the new period's spend replaces the old

    @unit
    Scenario: a bundle with no budgets keeps the ordinary staleness clock
      Given a cached key with no budgets
      When its config passes the staleness TTL
      Then the refresh revalidates against the version token as before

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

  Rule: A provider change reaches every key of its organization

    # A new provider, or one enabled or granted a wider scope, is in no cached
    # bundle yet, so matching the event on the provider id alone evicts nothing.
    # A key resolved before the change would keep answering
    # model_provider_not_bound for the new provider (for example Langy's
    # managed key after OpenAI is added next to Bedrock) until revalidation.

    @unit
    Scenario: A provider added to the organization reaches keys already cached
      Given a key of organization "acme" cached while it had only a Bedrock provider
      And a key of another organization is cached
      When the change feed reports a new model provider for "acme"
      Then the "acme" key is evicted so its next request sees the new provider
      And the other organization's key stays cached

  Rule: A fetch in flight across a change event does not cache what it read before it
    The change feed only evicts entries already in the cache. A fetch that began
    before a key, config or budget change answers after it with what the control
    plane said before the change. That answer serves the request that made it,
    and is not cached. Each event stamps the key, project, organization or
    provider it reaches, so only fetches of those bundles are affected; a
    budget debit only marks the answer behind.

    @unit @regression
    Scenario: a revocation during a cold fetch keeps the key out of the cache
      Given a request for a key misses the cache and asks the control plane
      When the change feed reports the key revoked before the answer arrives
      Then the answer is not cached

    @unit @regression
    Scenario: a config change during a fetch is not hidden by the earlier answer
      Given a request for a key asks the control plane
      When the change feed reports a config change for the key before the answer arrives
      Then the request is answered and the answer is not cached
      And no denial is recorded
      And the next request fetches the changed config and caches it

    @unit
    Scenario: a change to another key does not stop a fetch from caching
      Given a request for a key asks the control plane
      When the change feed reports a change to a different key before the answer arrives
      Then the answer is cached

    @unit
    Scenario: a budget debit during a fetch caches the answer marked for refresh
      Given a request for a key asks the control plane
      When the change feed reports a budget update for its organization before the answer arrives
      Then the answer is cached and marked behind the update

    @unit @regression
    Scenario: a burst of budget debits does not stop the cache from filling
      Given a request for a key asks the control plane
      When the change feed reports 5000 budget updates before the answer arrives
      Then the answer is cached and marked behind the updates
      And a request that starts after the burst caches its answer caught up

    @unit
    Scenario: a key change during a fetch blocks only that key's publish
      Given requests for two keys ask the control plane at the same time
      When the change feed reports a config change for the first key before the answers arrive
      Then the first key's answer is not cached
      And the second key's answer is cached

    @unit @regression
    Scenario: a change during an outage refetch keeps the last known fallback
      Given a key evicted by a change-feed event is served from its last known config during an outage
      When a config change for the key lands while the refetch is in flight
      Then the request is still answered from the last known config
      And the last known config stays available for the next request
      And the restored entry is not cached

    @unit @regression
    Scenario: a rotation during an outage refetch drops the last known fallback
      Given a key evicted by a change-feed event is served from its last known config during an outage
      When the key is rotated while the refetch is in flight
      Then the last known config is not served
