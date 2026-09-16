# Operations the branch documents but does not serve — re-measured 2026-09-16

Supersedes `dev/docs/plans/unserved-documented-operations-2026-09-14.md`.

**The method changed, and it is stronger.** The Sep-12 and Sep-14 measurements
diffed two OpenAPI *documents*. This one diffs two *running instances*: an
`apidiff run` booted `origin/main` (`7b5e10e7ae`) and the branch
(`395125a55e`) side by side and probed the union, so an operation counted
absent here was actually requested and actually not answered — a published
family that does not work can no longer read as served, and a served family
that nobody documented can no longer read as missing.

Artefacts: `.apidiff/report-20260916-r5.json`, `.apidiff/ledger-20260916-r5.json`.

## Totals

| | Sep 12 | Sep 14 | Sep 16 |
| --- | ---: | ---: | ---: |
| union operations | — | — | 340 |
| probed | — | — | 210 |
| genuinely unserved | 70 | 65 | **44 probed-and-absent** |

The Sep-16 number is not the same measurement as the earlier two and should not
be read as a burn-down against them: it counts operations the run actually
probed and found absent on the branch, not operations one document names and
another does not.

## Two open questions from Sep 14, now closed

- **The enterprise-tier generator works.** Sep 14 could not confirm whether
  `LANGWATCH_BUILD_TIER=enterprise node dev/scripts/generate-modules.mjs` still
  failed on `Cannot find package '@langwatch/enterprise-licensing-server'`
  (reported Sep 12). Re-run today on a clean worktree: it succeeds and emits
  `scimServer` into `modules/server-modules.generated.ts` (48 modules against
  the core build's 46). **SCIM's 18 operations are a build-tier artefact of
  comparing an OSS-tier branch against a monolith that had no tier split — not
  a regression.** ADR-144 §6 is the governing rule: enterprise entries are
  emitted only in the enterprise build, "so the OSS output has no enterprise
  import at all."
- **The api process boots.** Sep 14 recorded `pnpm dev:api` dead on
  `AuthzApi is not defined` (`gateway.app.ts:477`), which blocked every live
  check that session. The branch instance booted cleanly in today's run
  (`ready at http://127.0.0.1:62386`), so that failure is gone and live
  verification is possible again.

## Closed this session

- **`POST /api/events/track`** — Class C, fixed in `2722423f6f`. `TraceApp`
  gained the four members the declaration always named
  (`assertPredefinedEventPayload`, `generateEventId`, `reportError`,
  `recordTrackedEvent`) and `trace.server.ts` now declares `trackedEventRest`.
  Guarded by `transport/__tests__/tracked-event.rest.declaration.unit.test.ts`,
  which fails on removal of the declaration.

## Two blockers that are not per-module work

**1. No app can replay a request, so neither legacy alias can mount.**
`trackedEventLegacyPathRest` (`POST /api/track_event`) and
`experimentV3AliasRest` (`/api/evaluations/v3`) are both written, both exported,
and both undeclared, for the same reason: each needs an app member
`forward(request: Request): Promise<Response>` that dispatches back into the
mounted family, and **nothing in the repository implements one**. The spec is
explicit that the alias must replay rather than handle
(`specs/api-reference/tracked-event-validation.feature`: "two handlers over one
recorder drift the first time one of them gains a check the other does not"), so
a second handler is not an acceptable shortcut. One mechanism unblocks both.

**2. `withTransports(...)` cannot express a conditional registration.**
The pre-conversion mounts registered a route only where the process had the
collaborator behind it — `apps/api/src/features/trace/traces-rest.mount.ts` at
`b383462d96^`: the metadata amendment is "absent where this process registered
no command queue, and then `PATCH /:traceId/metadata` is not registered at all
rather than answering 200 to a write it dropped." `defineServerModule`'s
`withTransports(...transports)` takes a static list with no predicate, so the
new shape has nowhere to put that condition. This is why several Class D routes
were dropped rather than ported, and it is a framework gap, not a module one.

Note the interaction with the tracked-event fix above: `trackedEventRest` is now
declared unconditionally and `recordTrackedEvent` refuses at request time with
`TraceIngestionUnavailableError`, exactly as `recordCapturedSpan` does for the
collector. **But the transport's handler catches that throw, logs it, and still
answers `200 "Event tracked"`** — so on a process with no recorder the route
answers success to a dropped write, which is the failure the rule above exists
to prevent. Making that refusal loud is a one-line change in
`transport/tracked-event.rest.ts`, which is lane-owned at the time of writing.

## Reclassified

- **`GET /api/traces/{traceId}/transcript` is not a gap.** The pre-conversion
  mount names it a deliberate absence: "the coding-agent transcript join is not
  supplied because `composeApiTraceReadStack` refuses
  `LogService.getLogsByTraceId` by name, and deriving a transcript without it
  would answer an empty one for every trace." It was unserved before the
  conversion too. Exclude it from the count rather than porting it.
- **`GET /api/trace/{id}`, `POST /api/trace/search`** are alias consolidation,
  not removals: the branch serves `/api/traces/{traceId}` and
  `/api/traces/search`, and main served both spellings.
- **`{id}` → `{projectId}` on the projects family** remains a parameter rename,
  same URLs — as Sep 14 already corrected.
- **Root `GET /`, `POST /`** remain a monolith document artefact.

## Remaining, by class

Classes as defined in the Sep-14 document.

| module / family | count | class | note |
| --- | ---: | :---: | --- |
| scim | 18 | A | **not a gap** — emitted at enterprise tier (verified today). `scim.app.ts:175` already refuses `plan_not_entitled` per organization, which is the intended shape: mounted, and refused per-org. |
| governance | 7 | B | `governance.server.ts` exists but exports worker factories, not a `defineServerModule` installer, so the generator skips it at every tier. Its package also carries 3 unresolved imports (`@ee/event-sourcing/…` ×2, `~/generated/prisma/client`). Module conversion. |
| dataset direct-upload | 5 | D | recipe at `b383462d96^`. The branch adds `/api/stored-objects/storedObjects.*`; confirm whether the upload flow moved there deliberately before porting. |
| langy control | 4 | B/C | needs `withTransportFacts` bindings the process refuses to boot without; the branch adds `/api/langy/conversations`, so confirm this is not a deliberate redesign before porting. |
| scenario-events | 3 | C | Closer than Sep 14 recorded: `ScenarioApp` **already holds** `simulations`, `scenarioTabs` and `broadcast` (scenario.app.ts:105-127, wired from `setup.members`), and `platformUrl` is already `ScenarioApi`'s. Only `extractInlineMedia` is unaccounted for — and the walk it names lives in `modules/trace/server/src/services/content/trace-content-extraction.service.ts`, inside **trace**, while the transport's comment says it is "the stored-objects vertical's". Scenario depends on neither. Blocked on where that walk belongs, not on wiring. |
| gateway providers | 4 | D | `gateway-platform.rest.ts` serves `virtual-keys`, `budgets`, `cache-rules` but not `providers`; the sub-route was dropped in conversion. File is lane-owned at the time of writing. |
| `/api/track_event` | 1 | C | blocked on blocker 1. |
| teams | — | C | listed Sep 14 (9 operations); **not** among today's probed-and-absent set. Re-measure before acting. |

## Checks

- `apidiff run -no-haven -branch-dir <clean worktree>` — exit 2 on a credential
  loss, not on differences. `-no-haven` boots the branch side from
  `-branch-dir` itself, so point it at a clean worktree, never a dirty checkout.
- Credential health is in `credentialChecks` in the report, `[base, candidate]`.
  Read it before reading any count: a run whose project key died compares two
  refusals and its agreement means nothing.
