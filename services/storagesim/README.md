# storagesim

haven's local S3. It answers the S3 calls the product makes, as S3 answers
them, over a disposable directory. Behaviour: `specs/setup/haven-storagesim.feature`.
haven runs it as the `storage` lane (`tools/thuishaven/app/plan_storage.go`).

## What the product calls

| Caller                                                                                                                     | Operation                                      | Auth               | Notes                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `packages/process-stores/src/object-storage-s3.ts` `signObjectUpload` (stored-object `createUpload`, e.g. dataset uploads) | PutObject                                      | presigned query    | signs `host;content-length;content-type`; the browser PUTs with that content type |
| same, `signObjectDownload`                                                                                                 | GetObject                                      | presigned query    | download links                                                                    |
| same, `writeObject` / `readObject` / `remove` / `probe`                                                                    | PutObject, GetObject, DeleteObject, HeadBucket | SigV4 header       | `forcePathStyle`, checksums only when required                                    |
| same, `heldDigest`                                                                                                         | HeadObject (`x-amz-checksum-mode: ENABLED`)    | SigV4 header       | no stored checksum is answered, so the product hashes the bytes itself            |
| `modules/stored-object/.../s3.stored-object-blob.repository.ts`, `s3.object-storage-migration-blob.repository.ts`          | Put, Get, Head, Delete object                  | SigV4 header       | path-style                                                                        |
| `modules/stored-object/.../s3.payload-staging.repository.ts`                                                               | PutObject, then a presigned GetObject          | header, then query | the presigned GET is fetched by nlpgo and langevals                               |
| `modules/trace/.../s3.trace-legacy-spool.channel.ts`                                                                       | GetObject, DeleteObject                        | SigV4 header       |                                                                                   |

Not pointed at storagesim: governance's `ListObjectsV2` reads a customer's own
bucket. Go services only fetch presigned URLs over plain HTTP.

## What it answers

- SigV4, `AWS4-HMAC-SHA256`, in the `Authorization` header or a presigned
  query, checked against `STORAGESIM_ACCESS_KEY_ID` / `STORAGESIM_SECRET_ACCESS_KEY`
  (both default to haven's `storagesim`). Any region; service `s3`.
- Refusals as S3 sends them, XML with `Code`, `Message`, `Resource`, `RequestId`
  (and a bare status on HEAD): no auth `403 AccessDenied`; bad signature,
  or a body length or content type other than the presigned one,
  `403 SignatureDoesNotMatch` (with `StringToSign` and `CanonicalRequest`);
  expired `403 AccessDenied "Request has expired"`; header date over 15 minutes
  off `403 RequestTimeTooSkewed`; unknown key id `403 InvalidAccessKeyId`;
  malformed credential `400 AuthorizationHeaderMalformed` /
  `AuthorizationQueryParametersError`; no length `411 MissingContentLength`;
  short body `400 IncompleteBody`; wrong hex `x-amz-content-sha256`
  `400 XAmzContentSHA256Mismatch`; over 5 GiB `400 EntityTooLarge`;
  missing key `404 NoSuchKey`; unknown bucket `404 NoSuchBucket`.
- Buckets: `STORAGESIM_BUCKETS` lists the ones that exist (a `PUT /<bucket>`
  adds one); unset, every bucket exists.
- PUT answers the MD5 as a quoted `ETag`; GET/HEAD answer `Content-Type`,
  `Content-Length`, `ETag`, `Last-Modified`, ranges and conditionals.
- `aws-chunked` bodies are decoded; `x-amz-decoded-content-length` is required.
- CORS for `STORAGESIM_CORS_ORIGINS` (preflights are unauthenticated, as on S3).

## Never executable

Objects are files named by the SHA-256 of `bucket/key`, written 0600 through a
temp file and a rename into a 0700 data directory; nothing is ever chmodded
executable. Reads open regular files only, never a symlink. Keys with a `.` or
`..` segment, a leading slash, a backslash or a NUL are refused with
`400 InvalidArgument`. Every GET answers `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: sandbox`, and `Content-Disposition: attachment`
unless the type is a plain image (PNG, JPEG, GIF, WebP, AVIF) or `text/plain`.

## Disposable

haven sets `STORAGESIM_DATA_DIR=<haven home>/storage/<slug>`. It survives
`haven down` today, as the databases do; removing it with `haven db reset` is
a pending thuishaven change.

## Left out

Virtual-host addressing, ListBuckets, ListObjects, multipart uploads, copy,
object tagging and ACLs, POST policy uploads, `response-*` overrides,
stored `Content-Disposition`/`Cache-Control`/user metadata, SSE, versioning,
stored checksums, per-chunk signature checks on `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`,
session-token validation and SigV4A. The product calls none of them.

The `/_sim/` console (`apps/storagesim-web`) is unauthenticated: a dev console on the stack's own routes.
