---
name: storagesim
description: "Use haven's local S3, storagesim, to store, inspect and assert on uploaded files. Use when someone says 'where did the upload go', 'presigned URL', 'S3 locally', 'storagesim', 'check the object exists', 'NoSuchKey', 'storage console', or needs to load-test uploads."
user-invocable: true
---

# storagesim

A local S3 answering the path-style calls the product makes (PUT, GET, HEAD, DELETE
object; HEAD and PUT bucket), with SigV4 (header or presigned) checked against one dev
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
GET    /_sim/api/requests            recent S3 calls with status
```

Or use any S3 client with path-style addressing, region `auto`, the dev key. A missing
key answers `NoSuchKey`.

## Seed and reset

- `STORAGESIM_SEED=1` (haven sets it) stores `seed/hello.txt` and `seed/sample.json` in
  `langwatch`; existing objects are left alone.
- Objects live in `STORAGESIM_DATA_DIR` (haven: `storage/<slug>/` under its home). Delete
  the directory, or DELETE objects over S3, to reset.

## Tests and load

- Hit the loopback port directly; presign with the AWS SDK against that endpoint.
- Object operations take one of 64 striped locks, so distinct keys do not serialise.
  Benchmark: `go test -bench . -benchmem ./services/storagesim`.
- Limits: single PUT up to 5 GiB, keys up to 1024 bytes; no listing, multipart or
  versioning.
