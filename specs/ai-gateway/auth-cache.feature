Feature: Gateway auth cache — hot path is zero RTT after first hit
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

    @integration
    Scenario: cold cache -> control plane -> cached for next request
      Given the auth cache is empty
      And the control plane will sign a JWT for "lw_vk_live_01HZX9K3M000000000000001" with revision 42
      When I send an authenticated request with that key
      Then the gateway calls POST /internal/gateway/resolve-key exactly once
      And the request is authorized
      And on the next request with the same key, the gateway makes zero control-plane calls
      And the hot-path auth step completes in less than 200 microseconds

  Rule: Cached JWT survives control-plane outage until it expires

    @integration
    Scenario: control plane down, cached JWT still valid -> request succeeds
      Given the cache holds a JWT with exp = now + 10 minutes for "lw_vk_live_..."
      And the control plane returns 503 on all endpoints
      When I send a request with that VK
      Then the gateway verifies the JWT locally (signature + exp)
      And the request proceeds to dispatch
      And no /resolve-key or /config call is made
      And /readyz still reports control_plane_reachable as degraded but /healthz is 200

    @integration
    Scenario: control plane down and cached JWT near expiry -> proactive refresh fails gracefully
      Given the cache holds a JWT with exp = now + 30 seconds
      And the control plane is unreachable
      When I send a request with that VK
      Then the gateway verifies the JWT locally (still valid)
      And the request succeeds
      And a proactive refresh is attempted in background
      And the failure is logged with level=debug (no user-visible effect)

  Rule: Short-lived JWT is refreshed before expiry

    @unit
    Scenario: JWT at 10 minutes triggers async refresh
      Given the cache holds a JWT with exp = now + 5 minutes (TTL 15m, refresh threshold 5m)
      When I send a request with that VK
      Then the gateway serves from cache immediately (zero added latency)
      And a background goroutine calls /resolve-key for a fresh JWT
      And the replacement bundle is stored in L1 (and L2 if configured)

  Rule: Revocation propagates within 60 seconds via long-poll /changes

    @integration
    Scenario: revoked VK stops working within 60s without restart
      Given "lw_vk_live_01HZX9K3M000000000000002" is cached with a valid JWT
      When the platform revokes that VK
      Then the next /changes long-poll returns an event {vk_id, kind: "vk_revoked"}
      And the gateway invalidates every L1 entry matching that vk_id
      And the next request using that key calls /resolve-key again
      And /resolve-key responds 403
      And the gateway returns 401 with error.type "virtual_key_revoked"
      And the whole propagation completes in under 60 seconds

    @integration
    Scenario: config update propagates via /changes without dropping traffic
      Given a cached bundle for vk with revision 42
      When the platform updates the VK config to revision 43
      Then the next /changes poll returns {vk_id, kind: "vk_config_updated", revision: 43}
      And the gateway fetches GET /internal/gateway/config/vk with If-None-Match:"42"
      And the response is 200 with the new config
      And the cache entry is updated in place
      And in-flight requests already dispatched are unaffected

    @integration
    Scenario: /changes long-poll survives a 25s no-op cycle
      Given no VK mutations happen during a 25s window
      When the /changes poll runs
      Then the control plane returns 204 No Content
      And the gateway immediately starts the next poll
      And the gateway never sleeps; the long-poll is the only wait

  Rule: L2 Redis cache warms new gateway nodes

    @integration
    Scenario: new gateway pod reads a cached bundle from Redis instead of calling /resolve-key
      Given Redis is configured and pod A has cached VK "lw_vk_live_..." for 3 minutes
      When pod B receives its first request with that VK
      Then pod B finds the bundle in Redis (L2 hit)
      And pod B populates its own L1
      And pod B does NOT call /resolve-key
      And the Redis value expires at the JWT's exp

  Rule: Bootstrap-pull enables gateway to serve when control plane is cold

    @integration
    Scenario: enterprise bootstrap-all pulls every non-revoked VK on startup
      Given GATEWAY_CACHE_BOOTSTRAP_ALL_KEYS=true
      And the control plane has 250 active VKs
      When the gateway starts
      Then the gateway calls GET /internal/gateway/bootstrap (paginated)
      And every page of non-revoked VK JWTs is warmed into L1
      And /startupz returns 200 after the last page is consumed
      And the gateway can serve requests even if the control plane goes offline immediately after

  Rule: L1 key material is never persisted to disk

    @unit
    Scenario: cache keys are SHA-256 hashes, not raw VK bytes
      Given a VK "lw_vk_live_01HZX9K3M000000000000001" is resolved
      When I inspect the cache keyset
      Then the key is the 64-char hex SHA-256 of the raw VK
      And the raw VK value is not stored anywhere in the cache entries
