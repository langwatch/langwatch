---
name: storagesim
description: "Use haven's local S3, storagesim, to store, inspect and assert on uploaded files. Use when someone says 'haven storage', 'where did the upload go', 'presigned URL', 'S3 locally', 'storagesim', 'check the object exists', 'NoSuchKey', 'storage console', 'haven sim storage', or needs to load-test uploads."
user-invocable: true
---

# storagesim

A local S3 answering the path-style calls the product makes (PUT, GET, HEAD, DELETE
object; HEAD and PUT bucket; ListObjectsV2, so upgradelab snapshots work against it), with SigV4 (header or presigned) checked against one dev
key. Code: `services/storagesim`, console `apps/storagesim-web`.

## Run it

- On by default in haven (`-storage` turns it off). Hosted in the `sims` lane.
- Console and S3 endpoint: `https://storage.<slug>.langwatch.localhost` (console at `/_sim/`);
  `haven status` shows the loopback port for drivers.
- Overlay sets `STORED_OBJECTS_BACKEND=s3`, `S3_BUCKET_NAME=langwatch`, `S3_ENDPOINT`, dummy
  keys (`storagesim` / `storagesim`), unless `.env` names them.
- Standalone: `make service svc=storagesim` (:5590).

## Inspect and assert

```
GET    /_sim/api/buckets   /objects   /object?bucket=&key=   /object/raw?bucket=&key=
GET    /_sim/api/requests            recent S3 calls: status, auth (presigned|header|none), requestId
GET    /_sim/api/presign?bucket=&key=[&method=PUT][&expires=s]   a presigned URL for this host
GET|PUT /_sim/api/settings   {"forcedError": 0|4xx|5xx}: PUT, GET and HEAD object answer an S3 InternalError with that status
POST   /_sim/api/seed                adds the demo objects, answers {"seeded": n}
DELETE /_sim/api/object?bucket=&key=   one object
DELETE /_sim/api/objects[?bucket=]     every object (in one bucket), answers {"deleted": n}
```

Private-storage org: bucket `langwatch-private` always exists; export `DATAPLANE_S3__dev__<orgId>=` main's JSON
(`endpoint` = the stack's S3 endpoint, that bucket, keys `storagesim`) before `haven up`.

Or use any S3 client with path-style addressing, region `auto`, the dev key. A missing
key answers `NoSuchKey`.

## Seed and reset

- `STORAGESIM_SEED=1` (haven sets it) stores `seed/hello.txt` and `seed/sample.json` in
  `langwatch`; existing objects are left alone. The console's "Add demo objects" and
  `haven sim storage seed` do the same on demand.
- Objects live in `STORAGESIM_DATA_DIR` (haven: `storage/<slug>/` under its home);
  `haven db reset` removes it. `haven sim storage clear [bucket]` empties it without a reset.

## Tests and load

- Hit the loopback port directly; presign with the AWS SDK against that endpoint.
- Object operations take one of 64 striped locks, so distinct keys do not serialise.
  Benchmark: `go test -bench . -benchmem ./services/storagesim`.
- Limits: single PUT up to 5 GiB, keys up to 1024 bytes; ListObjectsV2 only (no v1
  listing, no ListBuckets), no multipart or versioning. Listing reads every sidecar per page.

## From a terminal or agent

`--json` on every read; non-zero exit on failure; `--stack <slug>` reads another worktree.

```
haven sim storage buckets | objects [bucket] | list
haven sim storage object <bucket> <key> [--raw]     # --raw writes the stored bytes to stdout
haven sim storage delete <bucket> <key>
haven sim storage clear [bucket]                    # every bucket without one
haven sim storage presign <bucket> <key> [--put] [--expires=<s>]   # GET by default, 3600 s
haven sim storage fault --error <0|4xx|5xx>      # PUT/GET object refused with that status; 0 clears it
haven sim storage seed                              # the demo objects, as STORAGESIM_SEED does
```
