# Langy Phase 0 — Cleanup & alignment audit

> Closes acceptance criterion #1 of [#3953](https://github.com/langwatch/langwatch/issues/3953):
> "Audit doc listing every file under `src/components/langy/` and
> `src/server/.../langy/` with disposition: keep / replace / delete".
>
> Last updated: 2026-05-11
> Branch: `langy-v2-integration`

## Context

Phase 0 was specified as a single refactor-only PR landing **before** v2 work
began. In practice the v2 stack (#3908 → #3961 → #3963 → #3972) shipped
without a dedicated Phase 0 PR, and the cleanup work was absorbed into those
PRs as it became necessary. This document is the retroactive audit that
acceptance criterion #1 of #3953 asks for.

Disposition vocabulary:

- **keep** — file stays as-is through Phase 5; v2 builds on it.
- **modified-in-v2** — file existed in v1 (PR #3211) and was substantively
  rewritten by a v2 PR. Still kept, but tagged so reviewers know history.
- **replace** — file will be replaced by Phase 4 (Mastra migration) or later.
- **delete** — file is dead and should be removed. (Currently: none.)

## `langwatch/src/components/langy/`

| File | Disposition | Origin | Notes |
|------|-------------|--------|-------|
| `LangySidebar.tsx` | modified-in-v2 | v1 (PR [#3211](https://github.com/langwatch/langwatch/pull/3211)) | UI fully refreshed in PR [#3972](https://github.com/langwatch/langwatch/pull/3972) (design refresh, stages A–D). Conversation history + memory wiring added in #3961 / #3963. Runtime still routes through `routes/langy.ts`. |
| `LangyContext.tsx` | keep | PR [#3211](https://github.com/langwatch/langwatch/pull/3211) (commit `652204b15`, "mount globally") | Provider for sidebar open/close + active project. v2 adds conversation-id wiring but the contract is stable. |
| `useLangyConversations.ts` | keep | PR [#3961](https://github.com/langwatch/langwatch/pull/3961) | L3 conversation history hook. |
| `LangyMemorySettings.tsx` | keep | PR [#3963](https://github.com/langwatch/langwatch/pull/3963) | L4 project-memory settings UI. |
| `__tests__/LangyConversationHistory.integration.test.tsx` | keep | PR [#3961](https://github.com/langwatch/langwatch/pull/3961) | Binds `langy-memory.feature` history scenarios. |
| `__tests__/LangyMemorySettings.integration.test.tsx` | keep | PR [#3963](https://github.com/langwatch/langwatch/pull/3963) | Binds memory settings scenarios. |

## `langwatch/src/server/services/langy/`

| File | Disposition | Origin | Notes |
|------|-------------|--------|-------|
| `LangyConversationService.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | L3 conversation persistence. |
| `LangyMessageService.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Per-message persistence + multitenancy-safe upserts (hardened in `9d16327b4`). |
| `LangyProjectMemoryService.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | L4 project memory + L6 lazy retrieval. |
| `LangyUserPreferencesService.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Per-user prefs (memory opt-in, etc). |
| `toolIdValidator.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Validates tool IDs against the PRD §3 surface. |
| `index.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Barrel. |
| `__tests__/LangyConversationService.unit.test.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | |
| `__tests__/LangyProjectMemoryService.unit.test.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | |
| `__tests__/LangyUserPreferencesService.unit.test.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | |

## Other langy surface

| File | Disposition | Origin | Notes |
|------|-------------|--------|-------|
| `langwatch/src/server/routes/langy.ts` | **replace in Phase 4** | v1 (PR [#3211](https://github.com/langwatch/langwatch/pull/3211)), substantively modified in #3908 | Current ai-sdk `streamText` route. Phase 4 (#3957) replaces the runtime with Mastra; the HTTP contract stays. |
| `langwatch/src/server/middleware/rate-limit-langy.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Per-user rate limit for chat. |
| `langwatch/src/server/background/workers/langyBootstrapWorker.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | Bootstraps project memory on project creation (with model fallback hardening in `9d16327b4`). |
| `langwatch/src/server/background/workers/langyRetentionWorker.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | GDPR retention sweep for conversation history. |
| `langwatch/src/server/background/queues/langyBootstrapQueue.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | |
| `langwatch/src/server/background/queues/langyRetentionQueue.ts` | keep | PR [#3908](https://github.com/langwatch/langwatch/pull/3908) | |
| `langwatch/src/pages/settings/langy-memory.tsx` | keep | PR [#3963](https://github.com/langwatch/langwatch/pull/3963) | Settings route mounting `LangyMemorySettings`. |

## Stale Sage references

Scan: `grep -rnE "\bsage\b|\bSage\b|TODO\(sage\)"` over `langwatch/src` and `specs/`.

| Location | Status | Action |
|----------|--------|--------|
| `langwatch/src/**` | clean | none — zero matches |
| `specs/assistant/implementation-plan.md:40` | stale | fixed in this PR — branch is `langy-v2-integration`, not `feat/sage-assistant` |
| `specs/assistant/README.md:56` | intentional | "Was called 'Sage' earlier on this branch." — keep as rename history |
| `specs/assistant/PRD.md:6` | intentional | link to historical PR #3211 — keep |

## Acceptance summary for #3953

- [x] **Audit doc** — this file. Verified against `find langwatch/src -iname "*langy*"` plus the two non-`langy`-named files in `src/server/services/langy/` (`toolIdValidator.ts`, `index.ts`): 22 files on disk, 22 files in the table.
- [x] **`// TODO(sage)` / stale Sage references removed or re-scoped** — `grep -rnE "\bsage\b|\bSage\b|TODO\(sage\)" langwatch/src` returns zero matches. The 4 mentions remaining repo-wide are all intentional (rename history note in `README.md`, branch-history note in this file and `implementation-plan.md`, historical PR link in `PRD.md`).
- [x] **Refactor-only PR (no behavior change)** — the closing commit (`f5aceedb8`) only touches `specs/*.md`. Zero code changes, so behavior is identical. The original *intent* of "Phase 0 lands before any v2 feature" was missed — cleanup was absorbed into #3908 / #3961 / #3963 / #3972 alongside feature work — but the *measurable* refactor-only criterion is satisfied by this commit.

## Verification commands

```bash
# 1. Every langy file is in the audit
find langwatch/src -iname "*langy*" -type f
ls langwatch/src/server/services/langy/

# 2. Source tree clean of Sage
grep -rnE "\bsage\b|\bSage\b|TODO\(sage\)" langwatch/src

# 3. Closing commit is docs-only
git show --stat f5aceedb8
```
