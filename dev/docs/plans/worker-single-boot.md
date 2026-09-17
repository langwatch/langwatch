# The worker should boot the way the api does

Measured 2026-09-17 on `feat/strict-feature-layout-v0`.

## The finding, in one number

`.withProvided(...)` injects an already-built application into a graph that
cannot resolve it itself.

| | `apps/api` | `apps/worker` |
| --- | --- | --- |
| `createApp` graphs | **1** | **8** |
| `*.composition.ts` files | **2** | **59** |
| references to the generated `serverModules` list | **7** | **0** |
| `.withProvided(...)` stitches | **1** | **46** |

The api boots once over the generated list:

```ts
const runtime = await createApp<ProcessMembers>({ role: "api", config, members })
  .withModules(serverModules)
  .withModules(coreAuditLog)
  .withProvided(ActivatedLicenseSource, licenseSource)
  .withService(...)
  .withTransports(...)
  .boot();
```

The worker builds **eight disconnected graphs**, each with a hand-picked module
array, and then hand-injects the applications they need from each other
**forty-six times**. `ProjectApi` is provided six times; `UserApi`, `AuthzApi`
and `AuditLogApi` four times each.

One graph resolves its own peers — that is what `static readonly dependencies`
and the `moduleApi` tokens exist for (ADR-144). Forty-six `withProvided` calls
are eight graphs being stitched back into the one graph they should have been.

## Why this produced the repository leaks

The generated list holds **49** modules. The worker installs **25** across its
eight graphs; **24 are never installed at all**. The twenty-four
`private-runtime-export` leaks split exactly along that line:

- **11 "second reader" leaks** — trace 3, project 2, topic 1, scenario 1,
  model-provider 1, data-privacy 1, coding-agent 1, api-key 1. The worker
  **already boots** these modules and hand-builds their persistence anyway. This
  is the case `worker-trace-capability-services.composition.ts` shows: the
  process boots `projectServer`, then builds a second `ProjectMetadataService`
  over `PrismaProjectRepository` and reads the same rows through it.
- **13 "not installed" leaks** — automation 6, langy 2, github 2, billing 2,
  user 1. The worker cannot take these applications because it never installs
  them, so hand-building is its only option.

Converting consumers one composition at a time closes the first group and cannot
close the second. The single boot closes both, because a module in the graph is
an application any other module can name as a dependency.

## The change

`apps/worker` boots exactly as `apps/api` does, with eventing where the api has
transports. The machinery is already there and already used: every one of the
eight graphs passes `role: "worker"`, and `worker-foundation-apps` already calls
`.withTransports(workerClosedDoors())` — the "closed doors" set, which is what
the worker mounts instead of real transports.

So the target is one call:

```ts
await createApp<ProcessMembers>({ role: "worker", config, members })
  .withModules(serverModules)
  .withTransports(workerClosedDoors())
  .boot();
```

What has to be reconciled to get there: eight `config` slices into one, eight
`membersFrom({...})` records into the one closed fourteen-key `ProcessMembers`,
and the forty-six `withProvided` stitches deleted as the graph starts resolving
its own peers.

## Follow-up: a lint for "defined but not installed"

Requested 2026-09-17, deliberately deferred until after the change above so it
can validate the result rather than the current state.

A module declares what it contributes; a process installs it. Nothing today
checks that the two agree, which is how the worker ended up with twenty-four
modules declared and never installed. The rule should fire per process role:

- a module with a `web` half that no `apps/ui/src/features/catalogue.json` entry
  installs
- a module declaring **eventing** that the worker's install list does not name
- a module declaring **transports** that the api's install list does not name

Each is the same defect: a half that exists, is built, is type-checked, and is
reachable from nothing. The existing `ABSENT_API_TRPC_NAMESPACES` record in
`apps/api/src/app-trpc/app-trpc.namespaces.ts` is the shape to copy for the
deliberate exceptions — it names each absent namespace and what the customer
loses, so the gap is written down rather than silent.
