# upgradelab

The upgrade harness (ruling D3 in `.claude/tmp/handoffs/plan-upgrade-snapshots.md`, "Rulings (Alex,
2026-10-09)"). It will take over what `dev/scripts/upgrade-rehearsal/` does (phases 0 to 7); that
script retires once upgradelab covers it. It holds the snapshot format (plan §4, lane L1), the
generator (`generate`, plan §3) and the matrix cell runner (`cell`, plan §5).

Specs: `specs/upgrade/upgrade-snapshots.feature`, `upgrade-snapshot-generation.feature`,
`upgrade-matrix.feature`.

## A matrix cell (`cell`)

```bash
go build -o .bin/upgradelab/upgradelab ./cmd/upgradelab        # from the repo root
.bin/upgradelab/upgradelab cell -deployment cloud -tier S -shape typical -seed 1
```

One cell from source, no Docker. The release it upgrades from (`-from-dir`, default
`.worktrees/upgradelab-main` at origin/main) runs `start:prepare:db` and boots its app and worker on
dedicated stores (`upgradelab_<cell>` on haven's native Postgres and ClickHouse, from `haven db url`,
plus its own `redis-server`). The tenancy SQL, the seed account and every product kind are seeded.
Seeded traffic (OTLP traces, collector, logs, metrics, API-key reads and writes, tRPC reads) goes
through the cell's balancer, one public address, from before the cut until after ready; a client
retries `upgrade_in_progress` 503s after Retry-After. The old worker pauses so jobs queue. Rolling
profiles (cloud, hybrid) start head's api (`-head-dir`) beside the old release, its worker
`-worker-delay` later (the worker runs the upgrade itself), switch the balancer once head answers
`-switch-on` (default `/readyz`), then stop the old release; stop-start profiles (self-hosted) stop
it first. A head api that exits before ready is restarted, as an orchestrator would, and counted (N7). A poller records head's phases, Playwright screenshots them and Ops > Upgrades
(`shots/`), and after settle the cell judges I0, I2, I2b, I3, I4, I6, I8, I9, N1 to N7, O1 and, for
hybrid, H1 to H3 into `report.md` and `report.json`. Exit 0 all pass, 1 an invariant failed, 2 a
step stopped the cell (its databases are kept for inspection).

Both checkouts must hold no `.env` (worktree hooks copy one in: delete it); every process gets an
environment built from `seed/env/<shape>.env` and the cell's stores only. `-deployment` picks a
`Profile` (`cell/profile.go`); a new deployment, tier or shape is a new entry there.

## Commands

```bash
cd tools && go run ../cmd/upgradelab snapshot <verb> [flags]   # cmd/upgradelab/main.go calls upgradelab.Run

upgradelab snapshot capture     -out DIR -meta meta.json [stores] [-allow-file FILE] [-forbid-env NAME]...
upgradelab snapshot restore     -from DIR [stores]
upgradelab snapshot fingerprint [stores]
upgradelab snapshot verify      -from DIR [stores]

stores: -postgres postgresql://user:pw@host:5432/db?schema=mydb
        -clickhouse shared=http://user:pw@host:8123/db   (repeat for private-<label>=URL)
        -redis redis://host:6379/2
```

Exit codes: 0 done, 1 `verify` found a difference, 2 usage, refusal or error.

- **capture** writes an empty directory: `postgres.dump` (`pg_dump -Fc --no-owner --no-privileges`,
  every schema including `<schema>_upgrade_ledger`), `clickhouse/<target>/schema.sql` (tables first,
  views last, database as `${CLICKHOUSE_DATABASE}`) and `<table>.native.zst` (`FORMAT Native`,
  zstd by the server), `redis.jsonl` (key, type, PTTL, DUMP), `snapshot.json`, `checksums.sha256`.
  `-meta` carries the producer's fields (id, recipe, release, image, shape, overlays, seed, anchor,
  expect); capture measures the rest. Any scrub finding removes the directory.
- **restore** refuses (ruling D7) any database not named `upgradelab_<name>` and any database or
  Redis index that is not empty, before writing anything. It renames the Postgres schema (and its
  ledger schema) to the destination's, and creates ClickHouse tables, then data, then views.
- **fingerprint** prints per table a count and an order-independent hash (Postgres: primary key,
  `bit_xor(md5)`; ClickHouse: sorting key, `groupBitXor(cityHash64)`, `FINAL` on merging engines).
- **verify** compares the stores with the manifest's fingerprint; with no stores, checksums only.

## Secrets

Snapshots are public (D6) and synthetic only (plan §4.4). The scrub reads every captured cell and
refuses provider-key, cloud-key, token and private-key shapes, and the value of each `-forbid-env`
variable. A refusal names table and column, never the value. `-allow-file` lists the shape's exact
test values. Postgres passwords travel in `PGPASSWORD`, never on the command line.

## S3 objects

`Stores.Objects` (List, Get, Put) captures the bucket into `objects.tar.gz`, keys preserved and
sorted, every body scrubbed; `objectCount` and an `objects` fingerprint go in the manifest. Restore
refuses any bucket not named `upgradelab-<name>` (S3 names allow no underscore) or not empty.
Deviation from plan §4.1: gzip, not zstd, because the standard library has no zstd encoder and
`klauspost/compress` would be a new `tools/go.mod` dependency. Only a fake implements it today.

## Not yet

Cell: the hybrid profile's private S3, the self-hosted profile's release-tag worktree, tiers L and
XL, the error-path drills (Retry, worker restart, api long before the worker), and snapshot
restore as the cell's origin instead of a live seed.

A real S3 client for `Objects` (and its `-objects` flag), `readback.json`, zstd for `redis.jsonl`, 1 GiB splitting, gitleaks
over the rendered dumps, OCI push and pull, and the harness phases. See
`.claude/tmp/handoffs/upgradelab-l1.md`.
