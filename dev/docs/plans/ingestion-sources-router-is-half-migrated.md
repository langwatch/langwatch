# The ingestion-sources router calls three names that do not exist

Found while working down `typecheck:tests` — the governance inventory page's
38 errors turned out to be downstream of this one file's 8.

## What is broken

`platform/app/src/server/api/routers/governance/ingestionSources.ts` is mounted
at `root.ts:870` and references four things that are not there:

| name | state |
| --- | --- |
| `toDto` | Defined nowhere. Called at lines 160, 169, 271. It was renamed to `toIngestionSourceDto` / `dtoForRow` in the same file; the call sites were not updated. |
| `hasPollerCursor` | Exists, and is exported from `@langwatch/enterprise-governance-server` — just never imported here. |
| `IngestionSourceService` | Exists in the governance package; used at line 141 as a parameter type, never imported. |
| `service.liveTraceProjectIds(...)` | Called by `dtoForRow`. No service anywhere declares it — the name appears only inside this file. |

The first three are omissions. The fourth is a design question: nothing yet
answers "which of these trace projects still exist", and `toIngestionSourceDto`
needs that set to fill `traceProjectArchived`.

## What it costs

`ingestionSources.list` is `rows.map(toDto)`. With `toDto` undefined that
throws `toDto is not defined` when the query runs, so the governance inventory
page cannot list its sources at all. `get` and the archive path fail the same
way.

It also erases the type for everything downstream. `Source` on the page is
`RouterOutputs["ingestionSources"]["list"][number]`, so a router output that
does not typecheck makes `Source` unknown, and every field read off it becomes
`'source' is of type 'unknown'` — 21 of the page's 38 errors, with the rest
following from the same cause.

## Related

This is the second unfinished piece found on this page. The first was
`buildOpenAiAdminPullConfig`, which was called and never written — fixed
earlier in 6d53a91be8, along with an `.strict()` that would have failed every
Anthropic Admin pull and two builders that wiped stored credentials on edit.

Both point the same way: the governance inventory surface was left mid-move,
and its failures are runtime ones that no test reaches.

## What it needs

Someone who can say where `liveTraceProjectIds` should come from. The three
missing imports fall out once that is settled — `list` wants the set resolved
once for the whole page rather than per row, which is why
`toIngestionSourceDto` takes it as a parameter and `dtoForRow` exists for the
single-row paths.
