# Security event retention backfill

PR1 stamps new identity and authorisation history with indefinite retention and
keeps later customer-retention updates from shortening it. Existing
`event_log` rows keep their old `_retention_days` value until this backfill is
run. Run it after the PR1 code is deployed and before the oldest affected rows
reach their current TTL. A mutation cannot restore rows ClickHouse has already
deleted.

Identity, credential, SSO, SCIM, membership, and authorization projections
are PostgreSQL state and are not part of tenant-retention sweeps. This runbook
does not mutate them. Explicit product operations such as revocation,
teardown, and privacy erasure remain authoritative; short-lived sessions and
verification proofs continue to expire normally.

Run this once against every ClickHouse database that stores `event_log`,
including private data-plane databases. Do not run it against a `Distributed`
view. In a sharded deployment, submit it once to the underlying table on each
shard. A Replicated database propagates the mutation through Keeper, so do not
submit the same mutation separately to every replica.

## Before the mutation

Check that replicas are healthy and that no other `_retention_days` mutation is
running on `event_log`. Take the normal ClickHouse backup before changing the
stored retention values.

Preview the affected rows with the exact predicate used by ingestion and the
retroactive retention service:

```sql
SELECT
    count() AS rows_to_update,
    min(toDateTime(EventOccurredAt / 1000)) AS oldest_ttl_anchor,
    max(toDateTime(EventOccurredAt / 1000)) AS newest_ttl_anchor,
    min(toDateTime(EventTimestamp / 1000)) AS oldest_accepted_at,
    max(toDateTime(EventTimestamp / 1000)) AS newest_accepted_at
FROM <database>.event_log
WHERE _retention_days != 0
  AND (
    startsWith(EventType, 'lw.identity.')
    OR startsWith(EventType, 'lw.authz.')
    OR EventType IN ('lw.governance.vk_lifecycle')
    OR AggregateType IN (
      'authz_grant',
      'authz_role',
      'user_identity',
      'sso_connection',
      'join_request',
      'scim_sync'
    )
  );
```

`EventOccurredAt` is the table's current DELETE TTL anchor. Its bounds show
which rows are closest to expiry. `EventTimestamp` is included separately as
the platform-accept-time range; it must not be substituted for the TTL anchor.

## Apply

The `_retention_days != 0` guard makes the mutation idempotent. Re-running it
only picks up security rows that still have a finite value.

```sql
ALTER TABLE <database>.event_log
UPDATE _retention_days = 0
WHERE _retention_days != 0
  AND (
    startsWith(EventType, 'lw.identity.')
    OR startsWith(EventType, 'lw.authz.')
    OR EventType IN ('lw.governance.vk_lifecycle')
    OR AggregateType IN (
      'authz_grant',
      'authz_role',
      'user_identity',
      'sso_connection',
      'join_request',
      'scim_sync'
    )
  )
SETTINGS mutations_sync = 0;
```

`mutations_sync = 0` submits the work without holding the operator's client
open for the lifetime of a large mutation. Do not start the next database and
assume this one has finished. Monitor it explicitly.

## Monitor and verify

`system.mutations` is local to the replica being queried. Check every replica
in each shard, or issue the monitoring query through `clusterAllReplicas` with
the deployment's configured cluster name. Monitoring every replica does not
mean submitting the mutation once per replica.

```sql
SELECT
    database,
    table,
    mutation_id,
    create_time,
    parts_to_do,
    is_done,
    latest_fail_reason
FROM system.mutations
WHERE database = '<database>'
  AND table = 'event_log'
  AND position(command, 'UPDATE _retention_days = 0') > 0
ORDER BY create_time DESC;
```

Completion means `is_done = 1`, `parts_to_do = 0`, and an empty
`latest_fail_reason` on every replica. Re-run the preview query after that. It
must return `rows_to_update = 0`.

The mutation changes only the stored retention marker. It does not add or alter
a ClickHouse schema migration, and it does not force an `OPTIMIZE FINAL`.
