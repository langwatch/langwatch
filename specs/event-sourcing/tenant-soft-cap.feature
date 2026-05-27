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

  # Defer-on-over-cap — when a tenant is at cap, the scheduler bumps that
  # tenant's over-cap groups to a future score so subsequent polls don't
  # re-scan them. Without this, every dispatch poll pays the full
  # scan-past-noisy-tenant cost (see #4209).

  @integration @tenant-cap @fairness @defer
  Scenario: Over-cap groups are deferred so they don't starve other tenants on repeated polls
    Given a tenant "proj_noisy" with cap=1 and 50 groups at the head of ready
    And a tenant "proj_quiet" with 1 group later in the zset
    When DISPATCH_LUA is invoked three times at the same nowMs
    Then the first call dispatches a "proj_noisy" group
    And the second call dispatches "proj_quiet"'s group after walking past over-cap noisy entries
    And the third call returns null immediately because the over-cap noisy groups were rescored to a future window
    And the deferred groups become eligible again once the defer window elapses

  @integration @tenant-cap @batch @defer
  Scenario: dispatchBatch defers over-cap groups the same way
    Given a tenant "proj_noisy" with cap=1 and 20 groups at the head of ready
    And a tenant "proj_quiet" with 1 group later in the zset
    When DISPATCH_BATCH_LUA is invoked
    Then over-cap "proj_noisy" groups are rescored to a future window
    And a subsequent batch poll at the same nowMs does not re-scan the deferred entries

  # DISPATCH_BATCH_LUA parity — the batch path shares the same cap logic
  # but iterates multiple groups per EVAL. These scenarios guard against
  # the batch branch drifting from the single-dispatch path above.

  @integration @tenant-cap @batch @fairness
  Scenario: DISPATCH_BATCH skips over-cap groups and dispatches under-cap groups in one call
    Given a tenant "proj_noisy" with cap=1 and 5 groups on the ready zset
    And a tenant "proj_quiet" with 1 group later in the zset
    When DISPATCH_BATCH_LUA is invoked with maxJobs=10
    Then "proj_noisy" dispatches exactly 1 group (hitting cap)
    And "proj_quiet" dispatches its group in the same batch

  @integration @tenant-cap @batch @blocked
  Scenario: Over-cap tenant with a blocked group does not affect other tenants
    Given a tenant "proj_noisy" at cap with a blocked group from a prior retry
    And a tenant "proj_quiet" with dispatchable groups
    When DISPATCH_BATCH_LUA is invoked
    Then "proj_noisy"'s blocked group is not dispatched
    And "proj_quiet"'s groups dispatch normally

  @integration @tenant-cap @batch @cleanup
  Scenario: Drift cleanup runs for under-cap tenants in batch dispatch
    Given a tenant "proj_acme" with a zombie group (empty jobs zset) on the ready zset
    When DISPATCH_BATCH_LUA is invoked
    Then the zombie group is removed from the ready zset

  # Over-cap groups are pushed to a future score instead of being left at the
  # head of ready, so repeated polls don't keep scanning past them every time.
  # A quiet tenant deeper in the zset is reached immediately, and a follow-up
  # poll returns nothing instead of re-walking the deferred groups; they become
  # eligible again after the defer window.
  @integration @tenant-cap @fairness
  Scenario: Over-cap groups are deferred so they don't starve other tenants on repeated polls
    Given a tenant "proj_noisy" over cap with many groups at the head of ready
    And a tenant "proj_quiet" with one group later in the zset
    When dispatch is polled repeatedly at the same time
    Then "proj_quiet"'s group is dispatched
    And the over-cap groups are pushed to a future score so the next poll skips them
    And they become eligible again only after the defer window

  @integration @tenant-cap @batch @fairness
  Scenario: dispatchBatch defers over-cap groups the same way
    Given a tenant over cap with groups on the ready zset
    When DISPATCH_BATCH_LUA is invoked
    Then the over-cap groups are deferred to a future score
    And under-cap tenants are still served in the same batch
