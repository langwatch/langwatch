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
    And the third group is parked out of the ready scan

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

  # Over-cap groups are moved OUT of ready into a per-tenant parked set instead
  # of being re-scored within ready on every poll, so dispatch write volume no
  # longer scales with backlog size (the 2026-05-27 over-cap ZADD storm, where
  # re-deferring a 442K-deep ready set every 5s saturated single-threaded Redis).
  # A quiet tenant deeper in the zset is reached immediately, a follow-up poll
  # returns nothing instead of re-walking the over-cap groups, and the parked
  # groups are restored to ready once the tenant drops below cap.
  @integration @tenant-cap @fairness
  Scenario: Over-cap groups are parked out of ready so they don't starve other tenants on repeated polls
    Given a tenant "proj_noisy" over cap with many groups at the head of ready
    And a tenant "proj_quiet" with one group later in the zset
    When dispatch is polled repeatedly at the same time
    Then "proj_quiet"'s group is dispatched
    And the over-cap groups are moved out of ready into the tenant's parked set so the next poll skips them
    And they are restored to ready once the tenant drops below cap

  @integration @tenant-cap @batch @fairness
  Scenario: dispatchBatch parks over-cap groups the same way
    Given a tenant over cap with groups on the ready zset
    When DISPATCH_BATCH_LUA is invoked
    Then the over-cap groups are moved out of ready into the tenant's parked set
    And under-cap tenants are still served in the same batch

  # Parked groups must come back. COMPLETE frees an in-flight slot and restores
  # one parked group immediately (the normal path), preserving its priority.
  @integration @tenant-cap @parking
  Scenario: A freed in-flight slot restores a parked group on completion
    Given a tenant over cap with a parked group
    When one of the tenant's in-flight groups completes
    Then the parked group is restored to ready and dispatchable
    And it keeps the score it had before being parked

  # COMPLETE covers the normal case; a crashed tenant never completes, so its
  # in-flight counter TTL-expires. A later poll must read the missing counter as
  # zero and restore the parked groups, or they strand out of the scan forever.
  @integration @tenant-cap @parking
  Scenario: A crashed tenant's parked groups are restored once its in-flight count expires
    Given a tenant over cap with a parked group
    And the tenant's in-flight counter has expired without a completion
    When dispatch is next polled past the reconcile interval
    Then the parked group is restored to ready and dispatched

  # Disabling the cap must not leave work stranded out of the dispatch scan.
  @integration @tenant-cap @parking @kill-switch
  Scenario: Disabling the cap restores all parked groups
    Given a tenant over cap with several parked groups
    When the cap is set to 0 and dispatch is polled past the reconcile interval
    Then all of the tenant's parked groups are restored to ready

  # Restoring is bounded by the freed headroom so it can't overshoot the cap and
  # churn groups back and forth between ready and parked.
  @integration @tenant-cap @parking
  Scenario: Restoring parked groups never exceeds the tenant cap
    Given a tenant at cap=2 with three parked groups
    When exactly one in-flight group completes
    Then exactly one parked group is restored to ready
    And the other two remain parked

  # Every writer that returns a group to ready must respect parked membership,
  # or it clobbers a parked group into the dispatch scan and re-creates the storm.
  @integration @tenant-cap @parking
  Scenario: Staging a new job for a parked group keeps it parked
    Given a tenant over cap with a parked group
    When a new job is staged for that parked group
    Then the group stays in the parked set and does not reappear in ready

  # In-flight count must survive an UNGRACEFUL worker death — incident 2026-05-28
  #
  # An ElastiCache node replacement dropped every worker's Redis connection mid-job,
  # bypassing the graceful drain that runs COMPLETE. The in-flight slots were never
  # released, so the tenant read as permanently at-cap and every one of its groups
  # was parked out of the dispatch scan: a live tenant stalled with thousands of
  # groups stranded while the workers sat ~90% idle. A scalar counter cannot tell a
  # live slot from one stranded by a dead worker. The in-flight slot is therefore
  # tied to the same liveness as the activeKey heartbeat: a slot whose heartbeat
  # lapsed stops counting against the cap, so an ungraceful mass death self-heals
  # within the active TTL instead of stranding the tenant forever.
  @integration @tenant-cap @self-heal
  Scenario: A tenant's in-flight slots self-heal after an ungraceful worker death
    Given a tenant at cap with several in-flight groups
    And the same tenant has additional groups parked over its cap
    And the workers holding the in-flight groups die without completing (no COMPLETE, no drain)
    When the in-flight slots' liveness lapses past the active TTL
    Then those slots stop counting against the tenant cap
    And the tenant's parked groups are dispatched again without an operator reset
