# The composition root, at four sizes

Owned by the `architecture-guide` skill. `config-composition.md` says what the
pieces are; this file shows them assembled, at the four sizes a composition
actually comes in. Every example is real code from this tree, not a sketch.

The point to take away first: **the composition root does not grow with the
system.** The api's production root went from 4,989 lines to 183, and installing
the next module adds **zero** lines to it. That is the whole design, and the four
stages below are what it looks like on the way.

## The two entry points

| Function | From | Use |
| --- | --- | --- |
| `createApp({ role, config, members })` | `@langwatch/runtime-composition` | A test, a narrow composition, anything that hands in its own members |
| `createProcess({ role, config, members })` | `@langwatch/infrastructure` | A real process. It builds the member record from a `ProcessConfig` and calls `createApp` for you |

`createProcess` is eight lines over `createApp`:

```ts
export function createProcess(options: ProcessOptions): ApplicationBuilder<ProcessMembers> {
  const members = createProcessMembers({ config: options.config, members: options.members });
  return createApp<ProcessMembers>({
    role: options.role,
    ...(options.moduleConfig ? { config: options.moduleConfig } : {}),
    members,
  });
}
```

## Size 1 - one module, nothing around it

An installation test. No members, no peers, memory repositories. This is the
smallest thing that boots, and every module has one.

```ts
function process() {
  return createApp({ role: "api", config: {} })
    .withModules([withMemoryRepositories(secretServer)]);
}
```

`withMemoryRepositories` swaps the module's registry onto its memory twin, which
is why the test needs no database. A module with no memory twin cannot be booted
this way - that is what the twin is for, and why a live repository without one is
a defect rather than a style choice.

## Size 2 - one module and its peers

`modules/annotation/server/src/app/__tests__/annotation-installation.unit.test.ts`,
verbatim:

```ts
function process() {
  return createApp({ role: "api", config: {} })
    .withProvided(ProjectApi, createAnnotationTestProjects())
    .withProvided(OrganizationApi, createAnnotationTestOrganizations())
    .withProvided(TraceApi, createAnnotationTestTraces())
    .withProvided(UserApi, createAnnotationTestUsers())
    .withProvided(AuthzApi, createAnnotationTestAuthz())
    .withModules([withMemoryRepositories(annotationServer)]);
}
```

Five peers, five lines. A peer arrives **by its `*Api` token**, never by importing
the peer's service or repository - which is what lets the test supply a double
without booting annotation's whole dependency chain.

Note what is absent: no `members`, because annotation reads none. A module that
reads nothing gets nothing, and the process opens no client for it.

## Size 3 - a module that reads a member, with config

`apps/worker/src/app/worker-agent.composition.ts`, verbatim. This is the shape
most real compositions land on:

```ts
const runtime = await createApp({
  role: "api",
  config: { agent: options.config },
  members: membersFrom(options.infrastructure),
})
  .withProvided(ApiKeyApi, peers.apiKeys)
  .withProvided(AuditLogApi, peers.auditLog)
  .withProvided(AuthzApi, peers.permissions)
  .withProvided(ProjectApi, peers.projects)
  .withProvided(ScenarioApi, peers.scenarios)
  .withProvided(TraceApi, peers.traces)
  .withProvided(UserApi, peers.users)
  .withProvided(WorkflowApi, peers.workflows)
  .withModules([withMemoryRepositories(agentServer)])
  .boot();

return { agents: runtime.service(AgentApi), runtime };
```

Three things appear here that size 2 had not:

- **`members`.** `AgentApp` declares `static readonly reads = reads("redis")`, so
  the process must supply `redis` or boot refuses **by name**. Not at first use -
  at boot, naming the module and the member.
- **`config: { agent: options.config }`.** The slice is keyed by module name, and
  a module that declares a config schema and gets no slice fails to compile
  rather than failing its zod parse at boot.
- **`.boot()`**, which is where anything is constructed at all. Before `boot`,
  nothing is built; after it, exactly the union the installed modules declared.

## Size 4 - the whole api

`apps/api/src/app/api-production.composition.ts`. The entire boot:

```ts
return createProcess({
  role: "api",
  config: apiProcessConfig({ config, secrets: options.secrets }),
  members: options.members,
})
  .withModules(serverModules)
  .withTransports(
    apiRestHosts({
      config: {
        internalSecrets: {
          cron: config.cronApiKey,
          "langy-internal": config.langyInternalSecret,
        },
        instanceAdminKey: config.instanceAdminApiKey,
        ...(options.browserSession ? { browserSession: options.browserSession } : {}),
      },
    }),
  )
  .boot();
```

That is it. Sixty-five families, 255 routes, every module in the product - and
the root is one `withModules`, one `withTransports`, one `boot`.

`serverModules` comes from `@langwatch/installed-modules/server`, generated by
`pnpm generate:modules` from `modules/catalogue.json`. **Installing a module
edits the catalogue, not this file.** That is why the root stopped growing.

The other 170 lines of that file are not composition. They are one pure function
mapping the api's own parsed config onto the `ProcessConfig` every process states
the same way - `mailSlice`, `redisSlice`, the ClickHouse private routes. Data,
not wiring.

## What the module side declares

The root is small because the module says what it needs:

```ts
export const traceServer = defineServerModule("trace")
  .withRepositories(traceRepositories)   // prisma | clickhouse | redis | memory
  .withApp(TraceApp)                     // implements TraceApi
  .withTransports(traceRest, traceTrpc)  // declarations, inert
  .build();
```

and on the App itself:

```ts
class AgentApp {
  static readonly reads = reads("redis");          // members, by canonical name
  static readonly dependencies = { projects: ProjectApi };  // peers, by token
  static readonly contract = AgentApi;
}
```

`reads(...)` names members from the closed set of fourteen: `logger`, `clock`,
`secrets`, `encryption`, `telemetry`, `prisma`, `clickhouse`, `objectStorage`,
`redis`, `cache`, `idempotency`, `rateLimiter`, `eventing`, `mail`.

## How it scales, in one table

| | Size 1 | Size 2 | Size 3 | Size 4 |
| --- | --- | --- | --- | --- |
| modules | 1 | 1 | 1 | all of them |
| lines in the root | 2 | 7 | 11 | 14 |
| peers | none | 5 `withProvided` | 8 `withProvided` | none - modules resolve each other |
| members | none | none | `membersFrom(...)` | `createProcessMembers` from config |
| transports | none | none | none | one `withTransports` |

The root grows from 2 lines to 14 while the system grows from one module to all
of them. Peers **disappear** at size 4 rather than multiplying: a test hands
doubles in by token, but a real process installs every module and they resolve
each other through the same tokens.

## What makes a root grow, and what to do instead

A root that is getting longer is a symptom. The three causes, and their answers:

- **Constructing a collaborator in the root.** It belongs in the module - a
  repository, a channel, or a service. If the root builds it, the root owns
  knowledge of the module's internals.
- **A bespoke `Infrastructure` bag handed to one module.** That was
  `.withInfrastructure(...)`, and it is gone. Each field is a canonical member, a
  peer `*Api`, a repository, a channel, or something the App derives itself.
- **A conditional.** `if (config.x) install(...)` in the root means the module
  should refuse by name at boot instead, which the member record already does.

`api-production.composition.ts` never grows. A change that needs it to grow has
found a gap in the primitives, and the honest move is to report the gap rather
than widen the root.
