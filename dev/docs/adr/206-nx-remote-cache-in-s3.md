# ADR-206: Nx remote cache in S3, trusted by who wrote it

**Date:** 2026-11-25

**Status:** Accepted

## Context

ADR-150 kept the Nx cache local. Every CI job starts from the GitHub Actions cache of its own branch or of main, so a pull request rebuilds what a laptop already built, and the run on main after a merge reruns the suites the pull request just passed. A shared cache removes that repeated work.

A shared cache is also a way in: an entry is trusted by its hash, so whoever can write an entry under a hash main will compute decides what main replays (CVE-2025-36852). Nx's own S3 cache package is commercial and deprecated since May 2026. Nx 23 still speaks a documented HTTP cache protocol (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER`) with no licence.

## Decision

Task results go to the private bucket `langwatch-dev-nx-remote-cache` in the lw-dev AWS account, created by langwatch-saas Terraform. Entries expire after 14 days. Only task outputs are stored, never `node_modules`.

Nx talks to a small local server (`dev/nx/remote-cache/`) that speaks the HTTP protocol and reads and writes S3 with SigV4, so the workspace root needs no AWS SDK. The bucket has three namespaces:

| Namespace        | Written by                                                                                | Read by                                      |
| ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `main/`          | CI on a push to main (role `langwatch-nx-cache-ci-main`)                                  | everyone                                     |
| `pr/`            | CI on a same-repository pull request or the merge queue (role `langwatch-nx-cache-ci-pr`) | everyone                                     |
| `branch/<name>/` | a laptop on that branch (AWS SSO), or a pull request job that used a laptop entry         | laptops, and that branch's pull request jobs |

Main never reads `branch/`. A pull request job reads `pr/`, then `main/`, then its own `branch/`. Once it uses a laptop entry it writes `branch/` for the rest of the job, so a result built from laptop output never reaches `pr/` and from there main. The bucket policy enforces who may write each namespace and that the main role cannot read `branch/`. An entry is written once (`If-None-Match: *`) and never replaced.

A laptop turns it on by having the `lw-dev-sso` AWS profile (`aws sso login --profile lw-dev-sso`); `LANGWATCH_NX_REMOTE_CACHE=0` turns it off and `LANGWATCH_NX_REMOTE_CACHE_PROFILE` names another profile. A laptop on main only reads. With no access, or when S3 fails, Nx runs on its local cache: the server answers a miss on read and success on write, because Nx fails the run when its cache server errors.

## Rationale / Trade-offs

A pull request's CI runs code that is not reviewed yet, and main trusts `pr/`. That is the same trust as merging: a person with write access to the repository. Forks get no OIDC token and cannot write. Laptops are a weaker boundary (local malware, an unpinned install script), so their entries stay out of main's reach entirely.

IAM cannot tie a laptop to its own branch, so any engineer can write any `branch/` namespace. That reaches only laptops and pull request jobs, never main.

Release images build in Docker from source and do not use this cache.

Traffic from S3 to GitHub-hosted runners is internet egress. Test results are a few kilobytes; `dist` outputs are larger, so uploads above 200 MB are skipped (`LANGWATCH_NX_REMOTE_CACHE_MAX_MB`).

## Consequences

The GitHub Actions caches stay; the remote cache only adds hits. Jobs that use it need `id-token: write` and the `nx-remote-cache` action before their first nx call. Adding a namespace or a writer means changing both `scope.mjs` and the bucket policy in langwatch-saas.

## References

- Related ADRs: ADR-150
- Spec: specs/ci/nx-remote-cache.feature
