# ADR-206: Nx remote cache in S3, trusted by who wrote it

**Date:** 2026-11-25

**Status:** Accepted

## Context

ADR-150 kept the Nx cache local. Every CI job starts from the GitHub Actions cache of its own branch or of main, so a pull request rebuilds what a laptop already built, and the run on main after a merge reruns the suites the pull request just passed. A shared cache removes that repeated work.

A shared cache is also a way in: an entry is trusted by its hash, so whoever can write an entry under a hash main will compute decides what main replays (CVE-2025-36852). Nx's own S3 cache package is commercial and deprecated since May 2026. Nx 23 still speaks a documented HTTP cache protocol (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER`) with no licence.

## Decision

Task results go to the private bucket `langwatch-dev-nx-remote-cache` in the lw-dev AWS account, created by langwatch-saas Terraform. Entries expire after 14 days. Only task outputs are stored, never `node_modules`.

Nx talks to a small local server (`dev/nx/remote-cache/`) that speaks the HTTP protocol and reads and writes S3 with SigV4, so the workspace root needs no AWS SDK. The bucket has three namespaces:

| Namespace        | Written by                                                                                       | Read by                                               |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `main/`          | CI on a push to main (role `langwatch-nx-cache-ci-main`)                                         | everyone                                              |
| `pr/`            | CI on a same-repository pull request (role `langwatch-nx-cache-ci-pr`)                           | everyone                                              |
| `branch/<name>/` | a laptop on that branch (through the cache gate), or a pull request job that used a laptop entry | members' laptops, and that branch's pull request jobs |

Main never reads `branch/`. A pull request job reads `pr/`, then `main/`, then its own `branch/`. Once a job uses a laptop entry it writes a marker in its branch namespace, and from then on every job of that branch writes `branch/` instead of `pr/`. A later job can restore GitHub Actions caches holding laptop output that never passed through the server, so the taint has to outlive the job. A result built from laptop output never reaches `pr/` and from there main. The marker read fails closed: only the object (taint) or a missing key (404, or 403 since the cache roles hold no `s3:ListBucket`) is a definite answer, and any other S3 error counts as a marker that is present. Only a push to main writes `main/`; a manual run gets no cache. The role ARNs are built from the account id in the `NX_CACHE_AWS_ACCOUNT_ID` secret. The bucket policy enforces who may write each namespace and that the main role cannot read `branch/`. An entry is written once (`If-None-Match: *`) and never replaced.

Laptops hold no AWS credentials. They reach S3 through the cache gate, a Lambda function URL in the same langwatch-saas root. The local server sends the developer's GitHub token (`gh auth token`) and the keys it wants; the gate checks that the token's user is a member of the `langwatch` GitHub org, keeps that answer for five minutes, rate-limits each token, and answers with presigned S3 URLs that live five minutes. A member reads `main/`, `pr/` and `branch/` and writes `branch/<name>/` only, each write URL bound to its length and to `If-None-Match: *`. Anyone else with a GitHub account reads `main/` only and writes nothing. The gate's role cannot write `main/` or `pr/`, and the bucket policy denies it there too.

`pnpm dev` and `haven up` run a check (`dev/nx/remote-cache/setup.mjs`): a machine signed in to `gh` hears nothing; with no login it prints one line saying the cache is off and to run `gh auth login`. A person at a terminal is told once (remembered in `~/.config/langwatch/nx-remote-cache.json`), an agent or a script every time. It never prompts, reads no input and never stops dev. `LANGWATCH_NX_REMOTE_CACHE=0` turns the cache off and `LANGWATCH_NX_REMOTE_CACHE_GATE` names another gate. A laptop on main only reads. With no login, a refused token, or a gate or S3 that fails, Nx runs on its local cache: the server answers a miss on read and success on write, because Nx fails the run when its cache server errors.

## Rationale / Trade-offs

A pull request's CI runs code that is not reviewed yet, and main trusts `pr/`. That is the same trust as merging: a person with write access to the repository. Forks get no OIDC token and cannot write. Laptops are a weaker boundary (local malware, an unpinned install script), so their entries stay out of main's reach entirely.

The gate authorises on membership of the `langwatch` GitHub org, which is not the same set as accounts with write access to this repository, and it cannot tie a laptop to its own branch, so any org member can write any `branch/` namespace. A member without write access can therefore place an entry that another member's laptop, or the pull request job of that branch, replays. That reaches only laptops and pull request jobs, never main: a job that replays a laptop entry writes `branch/` from then on, and main never reads `branch/`. Every org member is staff today; narrowing the gate to accounts with write access is a change to the gate in langwatch-saas, not to this repository. A GitHub token is the credential instead of an AWS session: a laptop needs no AWS account, and leaving the org ends access within five minutes. Non-members reading `main/` is deliberate: it holds what CI on main built from public source, and it makes a contributor's first build faster. The function URL takes no AWS auth, so the gate is reachable from the internet; it signs nothing for a token GitHub refuses, and its concurrency is capped.

Release images build in Docker from source and do not use this cache. The merge queue gets no role either: its OIDC subject names each queue branch, and the langwatch-saas infra tests refuse a role that trusts a wildcard subject.

Each CI job that uses the cache prints the server's log in an `Nx remote cache log` step and raises one warning when requests failed, so a cache that only misses shows on the run page. On a laptop the log is `.nx/remote-cache/server.log` in the worktree.

A laptop entry helps only if the laptop and the pull request job compute the same hash, so no task input may name the machine. Tasks hash the Node.js major version, not `node --version`, and whether each datastore variable a test guard reads is set (`dev/nx/test-datastores.mjs`: the `LANGWATCH_TEST_*` URLs and the older `DATABASE_URL`, `CI_CLICKHOUSE_URL` and `TEST_CLICKHOUSE_URL` names), not its address: CI and every worktree point at their own test databases, and a test run with one unset skips what a run with it set exercises. The local server batches the keys of concurrent lookups and writes into one gate call (the gate takes 32 keys a call and refills a token's budget at two calls a second) and rests five seconds after a 429, so a full `pnpm typecheck` no longer drops its uploads.

Traffic from S3 to GitHub-hosted runners is internet egress. Test results are a few kilobytes; `dist` outputs are larger, so uploads above 200 MB are skipped (`LANGWATCH_NX_REMOTE_CACHE_MAX_MB`).

## Consequences

The GitHub Actions caches stay; the remote cache only adds hits. Jobs that use it need `id-token: write` and the `nx-remote-cache` action before their first nx call. Adding a namespace or a writer means changing `scope.mjs`, the bucket policy and the gate's rules in langwatch-saas. The gate's URL is `GATE_URL` in `dev/nx/remote-cache/gate.mjs`, from the root's `gate_url` output.

## References

- Related ADRs: ADR-150
- Spec: specs/ci/nx-remote-cache.feature
