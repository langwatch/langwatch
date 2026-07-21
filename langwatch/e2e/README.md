# `langwatch/e2e/`

This directory is **not** a test suite and has no Playwright config. The E2E
suite lives in [`agentic-e2e-tests/`](../../agentic-e2e-tests/) — see
[ADR-010](../../dev/docs/adr/010-e2e-testing-strategy.md).

What remains here are three unrelated things that happen to drive a browser or
an HTTP client.

## `auth-regression/`

Standalone `tsx` scripts from the NextAuth → BetterAuth migration audit, with
real assertions and their own [README](./auth-regression/README.md). They need
an isolated Postgres and a dev server; `_smoketest-guard.ts` refuses to run
against a non-localhost `DATABASE_URL`.

The pure-HTTP assertions here (signup/signin/signout, the cross-origin CSRF
gate, rate limiting) are being ported into the headless tier of
`agentic-e2e-tests/`, where they run per-PR. The scripts that import the app's
own `auth.api.*` and verify via Prisma stay put — they are in-process, so they
are integration tests wearing a script's clothing, and moving them into the
standalone Playwright package would cost them their Prisma verification.

## `langy/`

Vitest scenario tests (`@langwatch/scenario`) with their own config and
[README](./langy/README.md). Needs a Minikube OpenCode pod and the AI Gateway.
Unrelated to Playwright.

## Dogfood walkers

`full-uiqa-walkthrough.ts`, `dogfood-claude-code-install.ts`,
`capture-my-usage-scrolled.ts`, `admin-ottl-dogfood.ts`,
`experiment-archive-dogfood.ts`, `workspace-switcher-dogfood.ts`,
`capture-ingestion-templates-screenshots.ts`.

These use the `playwright` **library** (not the test runner) as
`pnpm exec tsx e2e/<script>.ts` one-shots. They print their own pass/fail and
dump screenshots; several exist only to produce images for PR descriptions and
assert nothing. The first three are referenced as walkers by
[`dev/docs/runbooks/governance-dogfood.md`](../../dev/docs/runbooks/governance-dogfood.md).

Most read a session from `e2e/auth.json`. That file is gitignored and is no
longer produced by a script in this repo — capture one by hand, or point the
script at a seeded session.

## What was removed

`happy-paths/` (4 specs), `playwright.config.ts` and `save-auth-state.ts` were
deleted. The specs were pinned to a hardcoded project slug (`/fyes-lT_hZ2`) on a
hardcoded port, two of them never imported `expect` and asserted nothing, one
ended in `// TODO: Finish this test`, and no CI workflow ran any of them — the
config threw at load time unless a manually captured `auth.json` was present.
Per ADR-010, low-value tests are removed rather than healed.
