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

These tests live in `dev/tests/agentic-e2e/` and run on a schedule or before releases — not on every PR. They exist to catch catastrophic regressions, not to verify individual features.

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
- The `dev/tests/agentic-e2e/` directory remains for the stable happy-path suite.
- Feature files no longer need `@e2e` tags (they can still use `@integration` and `@unit`).
- The testing philosophy doc is updated to reflect this two-tier approach.
- The playwright agent definitions (`playwright-test-planner`, `playwright-test-generator`, `playwright-test-healer`) remain available for ad-hoc use but are not part of the standard workflow.

## Amendment 2026-09-06: four end-to-end suites, and why they exist

The two-tier strategy above held while the product was one application. The
strict feature layout migration proved it does not hold across four processes.
A walk on 2026-09-03 found that all three Node applications booted, answered
their health probes, and could not be used at all: the `/api/auth` REST family
was mounted by no process, so the browser walk stopped at sign-in. Every moved
unit and component test was green at the time.

So the strategy gains a tier. Four suites drive a running platform from
outside: a browser journey, and three outside-in suites over the TypeScript
SDK, the `langwatch` CLI and the MCP server. Eight decisions fix their shape.

1. **`dev/tests/agentic-e2e` is the browser suite.** It is the one CI runs and
   its selectors already cover the agent, suite, scenario and run leg. There is
   no second Playwright tree.
2. **Every suite reuses a stack when there is one, and boots one otherwise.**
   The resolution order is `LANGWATCH_E2E_BASE_URL`, then this worktree's haven
   stack, then a stack already answering at `BASE_URL`, and only then a boot of
   its own. One shared helper, `dev/tests/e2e-stack/`, owns that. Each suite
   has its own port slot, so two suites never collide locally.
3. **The browser journey signs up fresh. The three outside-in suites use the
   seeded project.** Sign-up is part of the product, so the browser test owns
   it. The other three need a key before their first call, and the idempotent
   seed supplies one. The constants are read from the seed file, never retyped.
4. **"The evaluator was hit" is proven through a monitor, not through a
   scenario run.** A scenario run is judged by its own criteria and references
   no project evaluator. A monitor is what runs a project evaluator on incoming
   traces. So the journey creates a code evaluator, creates a monitor, runs the
   simulation, and asserts the result appears on the run's trace. That
   exercises the worker, nlpgo and the trace pipeline together.
5. **The target agent answers.** The browser lane's global setup starts a tiny
   local HTTP agent on an ephemeral loopback port and registers it, so the run
   must complete. A journey does not accept a failed run.
6. **The model provider is a step, not a precondition.** A fresh self-hosted
   organization has no provider even with a key in the environment. The journey
   adds one, and chooses `openai/gpt-5-mini` wherever a model is asked for.
   Without the key, the run leg and the monitor leg skip with a named reason,
   and every other leg still runs.
7. **A known platform gap fails by name.** A test that covers an unmounted
   route is written as it should pass and marked `test.fail` with a one-line
   reason naming the gap. It turns red the day the gap closes, and the marker
   has to go.
8. **Specs first.** Each suite gets a feature file under `specs/e2e/` with
   `@e2e` scenarios, and every test carries a verbatim `@scenario` annotation.
   An error path is a scenario too.

The suites are a gate, not a convenience. Their first runs found eleven product
defects in a few hours, which measures what the unit and component suites could
not see. See `dev/docs/plans/strict-feature-layout.md` section 6.

## References

- Related ADRs: ADR-004 (Docker dev environment — provides the isolated instances for browser verification)
- `browser-tests/proof-of-concept/` — first successful AI-driven browser verification run
- `.claude/skills/browser-test/SKILL.md` — the replacement skill definition
