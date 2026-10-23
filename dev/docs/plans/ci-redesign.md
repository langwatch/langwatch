# CI redesign: one pull request workflow

Status: draft plan, 2026-10-23. Branch `feat/ci-redesign`.

## The problem

Most pushes are fine; about one in ten waits a long time for a runner. Measured
with `.github/scripts/ci-wait-report.ts` over 2026-10-16 to 2026-10-23 (476
pull request runs, 4 sampled per hour):

| Workflow             | Median total | 1 in 10 takes | Median longest job |
| -------------------- | ------------ | ------------- | ------------------ |
| langwatch-app-ci     | 14.8 min     | 31.4 min      | 13.1 min           |
| codeql               | 18.2 min     | 27.4 min      | 8.9 min            |
| e2e-ci               | 10.8 min     | 13.7 min      | 10.2 min           |
| langwatch-chart      | 12.8 min     | 31.2 min      | 9.4 min            |
| go-ci (mostly no Go) | 6.8 min      | 27.7 min      | 0.1 min            |
| mcp-javascript-ci    | 1.8 min      | 41.9 min      | 0.1 min            |
| sdk-go-ci            | 5.1 min      | 31.8 min      | 0.2 min            |
| langevals-ci         | 0.3 min      | 21.3 min      | 0.1 min            |

A job's wait for a runner: median 0, 1 in 10 waits 7 min or more, and up to
18 min at the busiest hours (00, 12, 13 and 17 UTC). One go-ci run on
2026-10-23 waited 13 min, then 7 min, to do 14 s of work. The slowest required
workflow sets when a pull request turns green: codeql at about 18 min on a
normal push, 30 to 40 min on a bad one.

One push starts 25 workflow runs and 85 jobs, 34 of which only skip. Each
workflow brings its own `changes` job and its own `*-complete` job, and each of
those queues for a runner against the organisation's concurrency limit.

Last 7 days of runs: about 1,000 from feature pull requests (241 cancelled after
taking a runner), about 870 from release-please pull requests, about 11 from
Dependabot. #8938 (merged 2026-10-21) already made release pull requests run a
lighter set and lets a newer main commit cancel an older run.

## Today's shape

| Group                                              | Workflows                                                                                                                                                                                                                                            | Runner cost when nothing relevant changed |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Product checks with a `changes` job                | langwatch-app-ci, e2e-ci, go-ci, go-services, langevals-ci, langwatch-nlp-ci, mcp-javascript-ci, sdk-go-ci, sdk-javascript-ci, sdk-python-ci, docs-ci, clickhouse-serverless, codeql, code-scanners                                                  | 2 jobs each (`changes` + `*-complete`)    |
| Small checks on every pull request, no path filter | architecture-section-check, cache-cleanup, issue-link, no-committed-screenshots, pr-impact-map, pr-token-usage, readme-links, release-scope-guard                                                                                                    | 1 job each                                |
| Checks with a path filter                          | agent-plugin-ci, clickhouse-serverless-chart, coderabbit-config-check, deployment-impact-check, gateway-matrix, ksuid-python-ci, langwatch-chart, langy-scenarios-sync, migration-compat, migration-order, ssrf-conformance, workflow-security-guard | none (GitHub does not start them)         |
| Need `pull_request_target`                         | pr-conventional-commits-title, pr-auto-approve                                                                                                                                                                                                       | stay as they are                          |
| LLM review                                         | pr-review-bot                                                                                                                                                                                                                                        | stays as it is                            |
| Release, publish, nightly, scheduled               | every `*-cd`, `publish-*`, `release-*`, nightly, upgrade-rehearsal, and the rest                                                                                                                                                                     | not on pull requests; untouched           |

Required checks on main: `validate title`, `review`, and ten `*-complete`
checks (app, e2e, nlp, langevals, mcp, sdk-go, sdk-javascript, docs, codeql,
clickhouse-serverless). There is no merge queue rule on main, although 14
workflows listen for `merge_group`.

## Target shape

```
pull_request / merge_group
  └─ pr.yml
       ├─ changes          one job; detect-changes + Nx affected, decides everything
       ├─ quick-checks     one job; the small every-PR checks as steps
       ├─ app      ─┐
       ├─ e2e       │      reusable workflows (workflow_call), each started
       ├─ go        │      only when `changes` says so; a skipped call
       ├─ python    │      starts no runner
       ├─ sdks      │
       ├─ docs      │
       ├─ security ─┘      codeql + code-scanners
       └─ ci-complete      the one required check
```

What stays the same: every step, the composite actions in `.github/actions/`
(`detect-changes`, `setup-pnpm-node`, `prepare-generated-files`, `nx-cache`),
Nx affected, release and publish workflows. This changes how jobs are started,
not what they run.

## Steps

Each step is its own pull request, smallest first, measured before and after.

| #   | Step                            | Change                                                                                           | Expected effect                                                         |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | Baseline (done)                 | `.github/scripts/ci-wait-report.ts`: wait against work, per workflow and by hour                 | the table above                                                         |
| 2   | Release pull request on a timer | release-please every 4 hours + `workflow_dispatch`; on push only when a release PR merged        | about 15 refreshes a day down to at most 6 (about 160 runs to 65)       |
| 3   | Drafts run light                | Drafts get lint and typecheck; `ready_for_review` starts the rest                                | most of the ~240 cancelled runs a week                                  |
| 4   | One pull request workflow       | `pr.yml` as above; product workflows become `workflow_call` only; quick checks fold into one job | 85 jobs down to about 35 to 45 a push; the bad pushes lose 15 to 25 min |
| 5   | Required checks                 | Add `ci-complete` as required, then remove the ten `*-complete` checks                           | needs a repository admin                                                |
| 6   | Merge queue                     | Turn on the merge queue for main; e2e and the slowest suites run in `merge_group` only           | about 11 min of e2e runner time off each push                           |
| 7   | Nightly                         | Take #8877 (one nightly suite) into this branch; it edits the same workflows                     | one place for nightly runs                                              |
| 8   | Dependabot                      | Spread the 23 ecosystems across the week, group updates, take #8639                              | no Monday spike                                                         |

## Expected result

|                             | Today        | After step 4   | After step 6   |
| --------------------------- | ------------ | -------------- | -------------- |
| Jobs a push                 | 85           | 35 to 45       | fewer again    |
| Pull request green, normal  | about 18 min | about 15 min   | about 15 min   |
| Pull request green, 1 in 10 | 30 to 40 min | about 18 to 20 | about 15 to 18 |
| e2e on a pull request       | about 11 min | about 11 min   | at merge only  |

A normal push gains little, because it is already close to the floor: the
longest real work, app CI's 13 min job and codeql's 9 min. The gain is in the
bad pushes and busy hours. Going below the floor means faster tests (#8948),
a faster codeql, or bigger runners, not fewer jobs.

## Decisions for Alex

1. **e2e only at merge (step 6).** An e2e failure then shows in the merge queue,
   which drops the pull request, not on the pull request itself. The middle
   option is e2e on a pull request only when it touches UI or api code.
2. **Required checks (step 5).** Changing them needs a repository admin, and
   open pull requests then need one rerun to report `ci-complete`.
3. **Release pull request cadence (step 2).** Merges land across about 21 hours
   of the day, so hourly saves little; every 4 hours lets a release PR lag main
   by up to 4 hours. Run the workflow by hand to refresh it sooner. Merging a
   release PR still publishes at once.
4. **Runners.** If busy hours still queue after step 4, the next lever is
   capacity: larger GitHub runners, a higher concurrency plan, or our own.

## Not part of this

- #8940 and #8947 (laptop test speed, off in CI): their own track.
- #8948 (jsdom tests in one process): merges on its own; it shortens the floor.
- Rewriting any step or composite action.
