# Operations the branch documents but does not serve — re-measured 2026-09-14

Supersedes `dev/docs/plans/unserved-documented-operations-2026-09-12.md`. That
list was produced before the OpenAPI document was refrozen; the frozen document
now matches the branch's own declarations exactly (`openapi-check` reports
`removed: 0, added: 8, changed: 0` against itself), so it can no longer be used
as the comparison target. **This re-measurement compares directly against
`origin/main`'s document instead** — the same target the Sep-12 number (310
published operations) came from — which is the minimal adaptation the method
needs now that the branch's own frozen document is trivially self-consistent.

## Method

1. Generate today's served document:
   `pnpm --filter @langwatch/platform-api task openapi-check` — writes
   `apps/api/node_modules/.cache/openapi/served-openapi-document.json` from the
   live declarations and diffs it against the frozen document. Result today:
   **276 declared operations** (was 258 on Sep 12), frozen document adds 8
   more the code declares but the document doesn't describe yet (`removed: 0`).
2. Pull main's document: `git show origin/main:platform/app/src/app/api/openapiLangWatch.json`
   — **310 operations**, unchanged since Sep 12.
3. Diff `(method, path)` pairs between the two, **normalizing path parameter
   names** (`{id}` vs `{projectId}` etc. collapsed to `{}`) — the Sep-12 method
   did not do this and it produces a false gap (see Correction below).
4. Exclude v1-canonicalization: a bare main path `/api/X` is not a gap if the
   branch serves `/api/v1/X` for the same method (`specs/api-reference/openapi-document-drift.feature`,
   "the document names one canonical address per declared route" — the address
   is still served at its bare spelling too, only the *documented* spelling
   moved).
5. Everything left is classified by reading the owning module's `*.server.ts`
   and `*.rest.ts` source directly (not by scan — a published family is not a
   working one, and a missing family is not necessarily an undeclared one).

Reproduce steps 1-4 with:

```bash
pnpm --filter @langwatch/platform-api task openapi-check
git show origin/main:platform/app/src/app/api/openapiLangWatch.json > /tmp/main-openapi.json
python3 - <<'EOF'
import json, re
def norm(p): return re.sub(r'\{[^}]+\}', '{}', p)
def ops(doc):
    r = {}
    for path, methods in doc.get('paths', {}).items():
        for m in methods:
            if m in ('get','post','put','patch','delete','head','options'):
                r.setdefault((m.upper(), norm(path)), []).append(path)
    return r
main = json.load(open('/tmp/main-openapi.json'))
branch = json.load(open('apps/api/node_modules/.cache/openapi/served-openapi-document.json'))
main_ops, branch_ops = ops(main), ops(branch)
removed = set(main_ops) - set(branch_ops)
still = []
for m, p in sorted(removed):
    if p.startswith('/api/') and not p.startswith('/api/v1/'):
        if (m, '/api/v1' + p[4:]) in branch_ops:
            continue
    still.append((m, p, main_ops[(m, p)][0]))
print(len(still))
for row in still: print(row)
EOF
```

## Correction to the Sep-12 method

A naive string diff (no parameter normalization) reports **70** unserved
operations, matching the Sep-12 total by coincidence of count only — the
*composition* differs (see below). Five of those 70 are the entire `projects`
family (`GET/PATCH/DELETE /api/projects/{id}`, `GET .../api-key`,
`POST .../regenerate-api-key`): main names the path parameter `{id}`, the
branch's `modules/project/process/src/transport/project.rest.ts` names it
`{projectId}`. `project.server.ts` registers `projectRest` and every one of
these routes is genuinely served. Normalizing parameter names removes all five.
**Real count: 65.**

## Totals, then vs now

|                              | Sep 12 | Sep 14 |
| ---------------------------- | -----: | -----: |
| main published                | 310    | 310    |
| branch generated              | 258    | 276    |
| genuinely unserved            | 70     | 65     |

The composition shifted underneath a similar total: `experiments` (8, fully
resolved — now served at its `/api/v1` twin), `gateway` spend routes (4 of 8,
now declared and awaiting only a document refreeze) dropped off the list;
`langy` control (6) and two `trace` sub-gaps (3) are newly counted, and 2 items
turned out to be a documentation artifact in main rather than a real gap (see
below). Re-run this method again before trusting any older total.

## Per-module table — 65 operations, five classes

**Class A — registered, not installed** (enterprise build tier).
**Class B — no installer at all** (module never converted to `*.server.ts`).
**Class C — declared, registered nowhere** (file exists, no module imports it).
**Class D — registered family, incomplete route set** (some of the family's
routes were never ported, or are gated behind an optional collaborator nobody
supplies).
**Not a gap** — served but undocumented by design, or a doc artifact in main.

| module / family              | count | class | evidence |
| ----------------------------- | ----: | :---: | -------- |
| scim (Users/Groups/meta)      |    15 | A | `enterprise/modules/scim/process/src/scim.server.ts:26` already registers all three families correctly; absent because the core build tier excludes enterprise modules. Unverified this session whether `LANGWATCH_BUILD_TIER=enterprise node dev/scripts/generate-modules.mjs` still fails on `Cannot find package '@langwatch/enterprise-licensing-process'` (reported 2026-09-12, not re-run — re-check before treating as closed). |
| scim-tokens                   |     3 | A | same enterprise-tier gap, same module. |
| teams                         |     9 | C | `modules/organization/process/src/transport/team.rest.ts` exists; `organization.server.ts`'s `withTransports(...)` does not import it. Prior session found it declares against transport-only tokens `defineServerModule`'s App-centric builder can't supply — needs `serverFeature()` or new `OrganizationApi` members, not a one-line registration. |
| governance                    |     7 | B | no `governance.server.ts` anywhere; REST lives in the older `transport/api-rest/{governance,governance-ingest,governance-cli}.api.ts` shape. Module conversion, not a rewire. |
| scenario-events               |     3 | C | scenario-event family declared (`[url]`, needs `platformUrl` on `ScenarioApp` per the agent precedent), not in `scenario.server.ts`'s transports. Recipe: `apps/api/src/features/scenario/scenario-rest.mount.ts` at `b383462d96^`. |
| events (track + legacy alias) |     2 | C | `modules/trace/process/src/transport/tracked-event.rest.ts` declares `trackedEventRest` (`POST /api/events/track`) and `trackedEventLegacyPathRest` (`POST /api/track_event`, `withDocs({hide:true})`); neither is in `trace.server.ts`'s `withTransports(...)` list (which carries `tracesRest`, `traceLegacyRest`, and two trpc transports only). |
| langy control                 |     6 | B/C | `modules/langy/process/src/transport/api-rest/langy-local-control*.api.ts` and `api-ws/langy-local-control.api.ts` are still the older shape; `langy.server.ts` registers only `langyTurnsRest`. Per the prior session's note, this family needs `withTransportFacts` bindings the framework says the **whole process refuses to boot without** — not merely a registration line. |
| gateway providers             |     4 | D | `gateway-platform.rest.ts` is registered and serves `virtual-keys`, `budgets`, `cache-rules` — but not `providers`. The `b383462d96^` recipe (`api-rest.doors.ts:830`, `mountGatewayPlatformRest`) mounted a `/api/gateway/v1/*` wildcard that covered providers too; the ported file dropped that sub-route during conversion. |
| dataset direct-upload         |     8 | D | `dataset` family is registered (9 other routes confirmed live) but the entire `direct-upload` sub-family, `POST /dataset/upload`, `POST /dataset/{slugOrId}/upload` and `PATCH .../records/{recordId}` are absent. Recipe: `apps/api/src/features/dataset/dataset-direct-upload-auth.ts` + `apps/api/src/app/api-packaged-rest.composition.ts` at `b383462d96^`. |
| traces transcript + metadata  |     2 | D | `modules/trace/process/src/transport/traces.rest.ts:307,342` — both routes exist in source, gated behind `if (readCodingAgentTranscript)` / `if (updateTraceMetadata)` inside `createTracesRest(options)`. `tracesRest = createTracesRest()` (line 443) passes **no options**, so both are permanently unregistered as currently wired — a composition gap, not a missing declaration. |
| trace-legacy read/search/share/unshare | 4 | not a gap (unverified live) | `trace-legacy.rest.ts` registers `getLegacyTrace`, `searchLegacyTraces`, `shareLegacyTrace`, `unshareLegacyTrace` at the exact main paths, every one `.withDocs({ hide: true })`. `traceLegacyRest` **is** in `trace.server.ts`'s `withTransports(...)`. This reads as intentionally undocumented-but-served (deprecation headers point callers at `/api/traces/*`), not a service gap — **could not confirm live this session, see Checks below.** |
| root `GET /`, `POST /`        |     2 | doc artifact | main's document body at path `"/"` is the prompts list/create schema verbatim. This is very likely a leftover of the old monolith's catch-all route generation, not a real endpoint — `/api/prompts` already serves both operations in the branch. Recommend excluding from any future count rather than porting. |

## Checks

**Generator run** — see the "Method" section above for the exact reproducible
command block; output confirmed: `declared: 276 operations`, `documented: 268`,
`removed: 0`, `added: 8`, `changed: 0`.

**Curl spot-check — NOT completed. `pnpm dev:api` does not boot on this tree.**
Attempted `PORT=5590 pnpm dev:api`; it fails before listening:

```
fatal boot failure: AuthzApi is not defined
ReferenceError: AuthzApi is not defined
    at GatewayApp.<static_initializer> (modules/gateway/process/src/app/gateway.app.ts:477:12)
```

`AuthzApi` **is** imported by value at `gateway.app.ts:59`
(`import { AuthzApi } from "@langwatch/authz-contract"`) and used in a class
field/static initializer at line 477 — the symptom matches an ESM circular
import (temporal-dead-zone at module-evaluation time), not a missing import.
This blocks the **entire** api process, not just gateway routes, so no live
curl was possible against any of the three planned targets (`GET /api/teams`,
`GET /api/governance/ingestion-templates`, `GET /api/scim/v2/Users` — all
expected 404 since none is registered on any App). This is a live, current,
unrelated boot failure on `feat/strict-feature-layout-v0` as of this session
and is worth its own lane; it also means the trace-legacy "hidden but served"
classification above is unverified.

## Not this session

- Re-verifying the enterprise-tier `generate-modules.mjs` failure (Class A).
- Fixing the `gateway.app.ts` boot failure (out of scope, no code changes
  owned by this lane, and orthogonal to the REST-family gap this doc tracks).
- Porting any of the above. This is a measurement only.
