Feature: Per-tenant soft cap on in-flight dispatch
  As an operator running multi-tenant event-sourcing infrastructure
  I want a hard ceiling on how many groups a single tenant can hold
  in flight at any moment
  So that a runaway tenant (eval loop, accidental fan-out, malicious
  client) cannot starve other tenants of dispatch slots.

  # Why this exists — incident 2026-05-11
  #
  # One tenant's evaluator-recursion loop produced ~500K groups in 90min.
  # The dispatcher had no per-tenant fairness, so the head of the ready
  # zset was full of that tenant's groups and other tenants were starved
  # for ~2h. The soft cap caps the runaway tenant at a small fraction of
  # cluster capacity; the scheduler scans past its over-cap groups and
  # serves the rest of the fleet.
  #
  # Ships ON by default (LANGWATCH_DISPATCH_TENANT_CAP unset → 50).
  # Operators set =0 as an explicit kill switch, or =N to retune.
  # Sized at ≈ GLOBAL_QUEUE_CONCURRENCY so a tenant tops out at one
  # pod's worth of slots — strong protection on multi-pod clusters,
  # effectively unlimited on a 1-pod self-host.

  Background:
    Given the GroupQueue is running with Lua scripts deployed

  @unit @tenant-cap @env
  Scenario: Tenant cap defaults to 50 when env var is unset
    Given the env var "LANGWATCH_DISPATCH_TENANT_CAP" is not set
    When readTenantCap() is invoked
    Then it returns 50

  @unit @tenant-cap @env
  Scenario: Explicit env=0 disables the tenant cap entirely (kill switch)
    Given the env var "LANGWATCH_DISPATCH_TENANT_CAP" is set to "0"
    When readTenantCap() is invoked
    Then it returns 0 and DISPATCH_LUA skips all cap-related branches

  @integration @tenant-cap @lifecycle
  Scenario: Counter increments on dispatch, decrements on completion
    Given a tenant "proj_acme" with no in-flight groups
    When DISPATCH_LUA dispatches one of its groups under cap=10
    Then the tenant_active:proj_acme counter equals 1
    When COMPLETE_LUA completes that group
    Then the tenant_active:proj_acme counter is deleted

  @integration @tenant-cap @lifecycle
  Scenario: RESTAGE_AND_BLOCK decrements the counter on exhausted retries
    Given a tenant "proj_acme" with one dispatched in-flight group
    When RESTAGE_AND_BLOCK_LUA fires (retries exhausted)
    Then the tenant_active:proj_acme counter is decremented

  @integration @tenant-cap @lifecycle
  Scenario: REFRESH keeps the tenant counter TTL aligned with activeKey
    Given a tenant "proj_acme" with one in-flight group nearing TTL expiry
    When REFRESH_LUA renews the heartbeat
    Then the tenant_active:proj_acme TTL is renewed in lockstep with activeKey

  @integration @tenant-cap @lifecycle
  Scenario: RETRY_RESTAGE keeps the tenant counter TTL aligned through backoff
    Given a tenant "proj_acme" with one in-flight group entering retry backoff
    When RETRY_RESTAGE_LUA reschedules the job
    Then the tenant_active:proj_acme TTL is set to the retry TTL

  @integration @tenant-cap @enforcement
  Scenario: DISPATCH_LUA refuses to dispatch when tenant is at cap
    Given a tenant "proj_acme" with cap=2 and 2 groups already in-flight
    And a third dispatchable group for the same tenant is on the ready zset
    When DISPATCH_LUA is invoked
    Then no group is dispatched for "proj_acme"
    And the third group remains on the ready zset

  @integration @tenant-cap @fairness
  Scenario: Over-cap tenant at the head of the zset does not starve other tenants
    Given a tenant "proj_noisy" with cap=2 and 200 over-cap groups at the head of ready
    And a tenant "proj_quiet" with 1 group later in the zset
    When DISPATCH_LUA is invoked
    Then the widened scan budget walks past the over-cap groups
    And "proj_quiet"'s group is dispatched

  @integration @tenant-cap @kill-switch
  Scenario: cap=0 produces zero tenant counter keys (back-compat regression)
    Given the env var "LANGWATCH_DISPATCH_TENANT_CAP" is set to "0"
    When a full dispatch then completion lifecycle runs for any tenant
    Then no tenant counter keys are ever created in Redis
