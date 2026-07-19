# ADR-050: Langy's prompts in the versioned prompt registry + dogfood scenarios/evals

**Date:** 2026-07-16

**Status:** Proposed

## Context

Langy is LangWatch's in-product AI assistant. Its behaviour is governed by two
prompt surfaces, both currently hardcoded in the repo:

1. **The agent-definition rules doc** — `services/langyagent/internal/assets/AGENTS.md`.
   Embedded in the manager binary via `//go:embed`, read once at pool start
   (`assets.AgentsTemplate()`), then written per-worker to `$HOME/AGENTS.md` with
   `${LANGWATCH_ENDPOINT}` substituted (`opencode.Provision`). opencode reads it as
   the project rules doc — this is Langy's durable system prompt. This is "the
   AGENT.md" of the ask.
2. **The per-turn `system` override** — `LANGY_OVERRIDE` (was inline in
   `langy-turn.service.ts`). The control plane composes it with the turn's context
   block and sends it to the manager `/chat` as the turn's `system` field.

We want both **stored in LangWatch's own versioned prompt registry on prod** — the
same `LlmPromptConfig` / `LlmPromptConfigVersion` tables customers use — so Langy's
prompts are versioned, diffable, promotable, and editable without a redeploy. This
is dogfooding: Langy's prompt should live in the prompt registry, and Langy should
be tested with LangWatch's own scenario + evaluation tooling.

Hard constraints that shape the design:

- **Langy must never fail to start a turn because a prompt row is missing,
  malformed, or the registry read threw.** The in-repo copy must remain a hard
  fallback.
- **A prompt row requires a `projectId` + `organizationId`; there is no global /
  "system" prompt scope** (`PromptScope` is only `PROJECT | ORGANIZATION`). Langy's
  agent definition is global to the deployment, not tied to a customer project, so
  *where* the canonical row lives is a genuine decision, not an implementation
  detail.
- **The platform process must never hold a `LANGWATCH_API_KEY`**
  (`langwatchPlatformGuard.ts`) — it would self-ingest its own telemetry. So any
  registry access from inside the platform must be a **direct service call
  (Prisma)**, never the SDK/CLI/HTTP path.

## Decision

### 1. Read Langy's prompts through a fallback-first loader

Add `src/server/app-layer/langy/langyPromptRegistry.ts`:

- `LANGY_PROMPT_HANDLES` — well-known slugs `langy-agent-definition` and
  `langy-turn-override`.
- `LANGY_TURN_OVERRIDE_FALLBACK` — the in-repo override text (moved here from
  `langy-turn.service.ts`, which now imports it), so the loader, the seed script,
  and the turn service share one source with no drift.
- `resolveLangyPrompt({ promptService, projectId, handle, fallback, tag? })` — calls
  `PromptService.getPromptByIdOrHandle` directly (no HTTP, no API key), pinned to
  the `production` tag by default, and **never throws**: any miss / empty / error
  returns the caller's fallback and logs at warn. Returns `{ text, source }` so
  callers can tell which path was taken.

This is the safe seam. Absent any registry row (today's state), every caller gets
the in-repo copy verbatim — behaviour is byte-identical until an operator opts in.

### 2. Store the canonical rows in an internal "LangWatch system" project (recommended)

Because a prompt row needs a `projectId`, the canonical Langy prompts live as
**ORGANIZATION-scoped** prompts under a dedicated internal project on the
deployment (a "LangWatch system" project in a staff org). Org scope means every
project in that org can read the row while only the holder can edit it. The loader
reads from that fixed project id (supplied via config, e.g.
`LANGY_PROMPT_PROJECT_ID`); when unset, the loader is simply not invoked and the
fallback stands.

The current text is inserted as **version 1** by a seed script,
`scripts/seed-langy-prompts.ts` (`pnpm seed:langy-prompts --project <id>`), which
reads `AGENTS.md` from disk + the override constant, upserts both handles
(idempotent — a new version only when the text changed), and promotes the new
version to `production`. It is a script, not a migration: prompt content is data,
and migrations in this repo are schema-only.

### 3. Wiring the loader into the runtime (staged; gated on the decision above)

- **Per-turn override (TS, cheap):** `langy-turn.service.ts` gains a
  `resolveLangyPrompt(...)` read for `langy-turn-override` when
  `LANGY_PROMPT_PROJECT_ID` is configured, else the constant. Behaviour-preserving.
- **AGENTS.md (cross-service, deferred):** the manager loads AGENTS.md from the
  embedded binary at pool start. Moving it to the registry means the **control
  plane** fetches `langy-agent-definition` via `resolveLangyPrompt` and passes it on
  the manager `/chat` / warm request (a new optional `agentsMd` field), and
  `opencode.Provision` prefers the passed value over the embedded template, falling
  back to embedded when absent. This touches the Go manager, the RPC contract, and
  the spawn path, so it ships as a follow-up once the internal-project decision is
  ratified. The embedded copy stays as the permanent fallback.

### 4. Dogfood Langy with scenarios + evals

- **Scenarios:** the existing `platform/app/e2e/langy/` `@langwatch/scenario` harness
  is the home. Add `langy-dogfood.scenario.test.ts` for the two named flows (find
  failing traces; open a PR) and `langy-rules.ts` — a reusable LLM-judge rubric
  encoding Langy's AGENTS.md absolute rules. The scenario reporting key lives only
  in the test-runner process (a `@langwatch/scenario` subprocess the platform guard
  explicitly exempts), never the platform.
- **Evals:** the scenario judge is the primary evaluator. For live traffic, a saved
  `langevals/llm_boolean` "Langy adheres to its rules" `Evaluator` bound as a
  Monitor, created **server-side** via `EvaluatorService` / the tRPC caller (no API
  key). Runbook in `e2e/langy/README.md`.

## Rationale / Trade-offs

An internal "system" project (Decision 2) is the only shape that gives a *single*
versioned source on prod without inventing a new global prompt scope. The
alternative — seeding Langy's prompt into every customer project lazily — was
rejected: it duplicates the prompt everywhere, splinters the version history, and
turns "edit the canonical prompt" into a fan-out re-seed, defeating the intent.
Adding a third `PromptScope` (`SYSTEM`) was also rejected as a larger schema +
authz change than the problem warrants when a well-known project id suffices.

The staged wiring (Decision 3) accepts that the big win — AGENTS.md in the
registry — lands after the cheap one, because it crosses the Go/TS boundary and the
critical spawn path. The fallback-first loader means each stage is independently
safe and reversible.

## Consequences

- New, tested seam (`langyPromptRegistry.ts`, unit-tested) that Langy prompts can
  be read through with a guaranteed fallback. No runtime behaviour change until an
  operator sets `LANGY_PROMPT_PROJECT_ID` and seeds.
- `langy-turn.service.ts` sources the override text from the shared module (verbatim
  move); the seed and loader can never drift from what the turn service falls back
  to.
- A documented, idempotent path to put the current prompts in the registry as
  version 1 and promote them.
- Open decisions for sign-off: (a) does every deployment bootstrap a "LangWatch
  system" org+project, and what is its id/ownership; (b) does the AGENTS.md
  cross-service cutover ship now or after the current Langy event-sourcing rework
  settles.

## References

- Related ADRs: 046 / 049 (event-sourced Langy), 047 (Langy foundations), 045
  (handled-error boundary), 043 (Langy egress).
- Spec: `specs/langy/langy-versioned-prompts.feature`,
  `specs/langy/langy-dogfood-scenarios.feature`.
- Code: `src/server/app-layer/langy/langyPromptRegistry.ts`,
  `scripts/seed-langy-prompts.ts`, `platform/app/e2e/langy/`,
  `services/langyagent/internal/assets/AGENTS.md`.
- Guard: `src/langwatchPlatformGuard.ts` (no `LANGWATCH_API_KEY` on the platform).
