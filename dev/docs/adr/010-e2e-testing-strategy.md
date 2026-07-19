# ADR-010: E2E Testing Strategy — Browser Verification Over Generated Tests

**Date:** 2026-03-11

**Status:** Accepted

## Context

We invested in an agentic E2E test generation pipeline: a planner agent explored the live app, a generator agent wrote Playwright specs, and a healer agent fixed failures. The `/e2e` skill orchestrated these four agents in sequence.

In practice, this approach had several problems:

1. **Brittleness.** Generated E2E tests broke constantly — UI changes, timing shifts, and Chakra UI rendering quirks caused frequent false failures. Each failure required the healer agent, which consumed significant tokens and time.

2. **Expense.** The full pipeline (planner + generator + healer + reviewer) used four agent invocations per feature. Most of the cost went to healing tests that would break again on the next UI change.

3. **Low signal.** E2E tests that verify every feature at the browser level duplicate coverage already provided by integration tests. A form that renders correctly and submits via tRPC is already tested at the integration level — clicking through it in a browser adds cost without catching new bugs.

4. **Maintenance burden.** Generated test code was hard to maintain by hand. When the healer couldn't fix a test, developers had to debug auto-generated Playwright code they didn't write.

Meanwhile, we found that **interactive browser verification** — an AI agent driving a real browser to spot-check a feature — gave us the confidence we needed without the overhead of maintaining a test suite.

## Decision

We will adopt a two-tier browser testing strategy:

### Tier 1: Interactive Browser Verification (primary)

The `/browser-test` skill replaces `/e2e` as the standard verification step in the orchestration workflow. An AI agent drives a real browser against a local dev instance, walks through scenarios, takes screenshots, and reports results. No test files are generated or maintained.

This runs as part of both bug-fix and feature workflows in `/orchestrate`.

### Tier 2: Stable Happy-Path E2E Tests (minimal suite)

We maintain a small set (5-10) of Playwright E2E tests that cover the core happy paths of stable, established features:

- Sign in and reach the dashboard
- Create and view a trace
- Run an evaluation
- Navigate between major sections

These tests live in `agentic-e2e-tests/` and run on a schedule or before releases — not on every PR. They exist to catch catastrophic regressions, not to verify individual features.

We will not generate new E2E tests per feature. Existing tests that are stable can remain; flaky or low-value tests should be removed rather than healed.

## Rationale / Trade-offs

**What we gain:**
- Faster feedback loop — browser verification runs in one agent invocation, not four
- No test maintenance burden — screenshots are evidence, not code to maintain
- Coverage where it matters — integration tests handle edge cases, browser verification handles visual/interaction confidence

**What we give up:**
- Automated regression detection at the browser level for individual features
- The ability to run a full E2E suite per PR

**Why this is acceptable:**
- Integration tests already catch most regressions
- The small stable E2E suite catches catastrophic breakage
- Interactive browser verification catches visual/interaction issues during development
- The cost of maintaining per-feature E2E tests exceeded the bugs they caught

## Consequences

- The `/e2e` skill is removed. The orchestration workflow uses `/browser-test` instead.
- The `agentic-e2e-tests/` directory remains for the stable happy-path suite.
- Feature files no longer need `@e2e` tags (they can still use `@integration` and `@unit`).
- The testing philosophy doc is updated to reflect this two-tier approach.
- The playwright agent definitions (`playwright-test-planner`, `playwright-test-generator`, `playwright-test-healer`) remain available for ad-hoc use but are not part of the standard workflow.

## Amendment: Headless E2E tier (2026-07)

### Context

The 2026-03 decision holds, and this amendment does not relax it. But re-reading
the four objections above — brittleness, expense, low signal, maintenance
burden — every one of them is a property of **driving a browser**, not a
property of end-to-end testing. Chakra rendering quirks, timing shifts and
auto-generated Playwright selectors are what made the old suite expensive. None
of that applies to a test that POSTs to a route and reads a database row.

Capping the browser suite therefore left a specific class of surface with no
end-to-end coverage at all, because it has no browser step to cap:

- **Automations dispatch.** `specs/automations/process-manager-dispatch.feature`
  carries 20 scenarios of asynchronous behaviour — cadence coalescing,
  settlement re-arming, at-most-once per trace per automation, survival across
  queue loss, sweep leader election. All of it is covered only by unit tests
  with mocked queues. Nothing exercises author-an-automation → trace arrives →
  notification actually delivered. The unit tests assert our *model* of the
  queue, which is exactly where this class of bug hides.
- **nlpgo.** 21 specs and good Go integration tests, all stopping at the service
  boundary. The app↔service contract itself is unverified.
- **The CLI's install commands.** `langwatch <tool>` and `langwatch ingest
  install` mutate real user files (`settings.json`, `config.toml`, shell rc).
  `langwatch logout` must remove only langwatch-authored blocks. This is
  file-system round-trip behaviour that unit tests stub out.
- **Annotations.** UI, API, CLI and three MCP tools, and zero `.feature` specs.

These are not "verify a form renders" tests. They cross real process boundaries
and assert real side effects, and they are cheap, fast and deterministic.

### Decision

Add **Tier 3: Headless E2E**, and make the tiers differ by *cost*, not by area.

Tier 3 runs against a real app, real Postgres/Redis/ClickHouse and real queues,
over HTTP and over process boundaries (spawning the CLI). **No browser.** It is
exempt from the 5-10 cap, because the cap exists to bound browser maintenance
cost and Tier 3 does not incur it.

A test belongs in Tier 3 only if it:

1. crosses a real process or service boundary (HTTP route, queue, spawned
   binary) — otherwise it is an integration test and belongs there;
2. needs no browser to express its assertion;
3. asserts a deterministic side effect — a row, a delivered payload, a written
   file, an exit code. No LLM-judged assertions, no "some string appeared
   somewhere on the page";
4. provisions its own organisation and project and touches no shared state.

Rule 4 is load-bearing and is the reason the suite could not parallelise before:
the members specs upload and remove an enterprise licence on the one shared org,
which would leak into `settings/plans-comparison.spec.ts` asserting Free is the
current plan. Per-test provisioning removes that coupling.

### Slice boundaries

The suite splits into Playwright projects that differ in isolation cost, so the
cheap ones can run wide:

| Project    | Browser | Parallel   | Runs on          | Contains                                       |
| ---------- | ------- | ---------- | ---------------- | ---------------------------------------------- |
| `api`      | no      | fully      | every PR         | Tier 3 — HTTP/queue/side-effect assertions     |
| `cli`      | no      | fully      | every PR         | Tier 3 — spawned binary against a temp `HOME`  |
| `ui`       | yes     | per-worker | schedule/release | Tier 2 — the capped 5-10 happy paths           |

### This also resolves a live drift

ADR-010 states the browser suite runs "on a schedule or before releases — not on
every PR". `.github/workflows/e2e-ci.yml` has been running it on every
`pull_request` regardless, non-blocking, with no `timeout-minutes` (so a hung
boot can burn the 360-minute default).

We resolve it in the ADR's favour, which is also the faster answer: the headless
projects run per-PR and are eligible to block; the browser project moves to
schedule and pre-release. PRs get *more* coverage and *less* wall-clock, because
what they gain is parallel and headless and what they lose was serial and
browser-driven.

### Consequences

- The 5-10 cap now explicitly scopes to the `ui` project. Tier 3 grows with the
  product.
- Seeding is now infrastructure, not a per-test workaround. The suite gets a
  provisioning module; "click through the UI to create the data" stops being the
  documented strategy for non-UI tests.
- `workers: 1` goes away. It was load-bearing for shared-org licence toggling,
  not for correctness.
- Tier 1 (`/browser-test`) is unchanged and remains the primary way a feature
  gets visually verified during development.
- `langwatch/e2e/`'s HTTP auth-regression smoketests are Tier 3 by this
  definition and move into the suite; its browser happy-path specs, which are
  pinned to a hardcoded project slug and a manually captured `auth.json` and are
  run by no workflow, are deleted rather than healed — per the original
  decision's own instruction.

## References

- Related ADRs: ADR-004 (Docker dev environment — provides the isolated instances for browser verification)
- `browser-tests/proof-of-concept/` — first successful AI-driven browser verification run
- `.claude/skills/browser-test/SKILL.md` — the replacement skill definition
- ADR-052 (automations on the process-manager substrate) — the dispatch behaviour Tier 3 covers end-to-end
