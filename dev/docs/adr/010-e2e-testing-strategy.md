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

## References

- Related ADRs: ADR-004 (Docker dev environment — provides the isolated instances for browser verification)
- `browser-tests/proof-of-concept/` — first successful AI-driven browser verification run
- `.claude/skills/browser-test/SKILL.md` — the replacement skill definition
