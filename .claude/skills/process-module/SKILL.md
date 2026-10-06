---
name: process-module
description: "Write or change a module's process half (modules/<name>/process/src): services, repositories (prisma and memory twins, registry), channels (messages to anything the module does not own), rules, the thin module class, the installer file, file names the linter accepts. Use when someone says 'add a service', 'add a repository', 'new channel', 'memory twin', 'rules file', 'where does this logic go', 'repositories/prisma', 'process/src', 'thin module class', 'feature folder', 'features/<concern>', 'the linter refused this filename', or opens modules/*/process/src."
user-invocable: true
---

# A module's process half

Record: `dev/docs/ARCHITECTURE.md` §3.2 (process half and grammar), §7
(stores), §12 (errors), §16 (today's names). Exemplars: `modules/monitor/process`
(minimal), `modules/automation/process`, `modules/organization/process`.
The grammar file, not this skill, decides filenames:
`packages/oxlint-rules/grammar/feature-layout-policy.mjs` (`PROCESS_HOMES`).

**Repository = owned state. Channel = messages to anything the module does not
own. Service = behaviour over both. Rules = pure decisions.** Transports,
repositories, channels and the module class stay thin.

## Today's layout (monitor)

```
process/src/
├── index.ts                    installer + transport declarations, nothing else
├── monitor.module.ts           the installer
├── app/monitor.app.ts          the module class (`MonitorModule`), where §3.2 puts it
│                               (Alex, 2026-10-05)
├── services/*.service.ts       behaviour, one class per entity
├── repositories/
│   ├── monitor.repository.ts           interface
│   ├── monitor.repositories.ts         the bundle { monitors: MonitorRepository }
│   ├── monitor-repositories.registry.ts   defineRepositories({ live, memory })
│   ├── prisma/prisma.monitor.repository(ies).ts
│   └── memory/memory.monitor.repository(ies).ts
├── rules/*.rules.ts            pure functions and constants
└── transport/*.{rest,trpc}.ts  declarations only (see api-transports)
```

Also allowed: `channels/` (+ tier folders), `eventing/` (one folder, one
pipeline), `tasks/*.task.ts`, `migrations/`. `*.members.ts` files are deleted
(§3.3, §15); a module's needs are resolved by the container (§5).
`utils/`, `ports/`, `adapters/`, `composition/`, `lib/`, `helpers/`, `domain/`
are refused (§3.2).

Past 30 source files in a folder, group into concerns:
`process/src/features/<concern>/{services,rules,repositories,eventing}/`, one
level, never `features/<a>/features/<b>/` (§3.4, ruled 2026-10-01). The grammar
accepts it; no module has moved yet.

## Rules that matter

1. **A service is a small class over interfaces.** `MonitorService` takes
   `{ repository, evaluators: Pick<EvaluatorApi, "getById">, generateId }`
   through `static create(options)` with a private constructor
   (`services/monitor.service.ts`). A service never opens a channel, a client
   or a store itself.
2. **A repository interface sits at the top of `repositories/`; backends below.**
   Only `repositories/prisma/**` names Prisma, through
   `PrismaRepository.for("Monitor")`. Every project-model query carries
   `projectId`. Every ClickHouse query filters `TenantId` first (§3.2).
3. **Every backend has a memory twin**, same interface, same contract test
   (`repositories/__tests__/monitor.repository.contract.test.ts`). Memory
   bundles `requires = []` so tests need no Docker.
4. **Never a raw client inside a module class or service.** Raw clients cross
   in exactly one place, a registry or channel factory, and arrive as
   repositories and channels (§3.2). The cipher is a registry input: the live
   registry `requires` `encryption` and the live Prisma repository seals and
   opens; memory twins hold plaintext and services never seal. A rate limiter is
   a named `<module>-rate-limit.repository.ts` with a memory fixed-window twin
   (record §3.3, coordinator members wave, 2026-10-05).
5. **A channel is one interface per subject, a class per tier, a memory twin
   and a registry.** Organization's invitation mail:
   `channels/organization-invite-mail.channel.ts` (abstract class),
   `channels/ses/ses.*.channel.ts`, `channels/memory/memory.*.channel.ts`,
   `channels/organization-invite-mail-channels.registry.ts`
   (`{ ses, memory }`). Tier folders: `http`, `memory`, `redis`, `s3`, `ses`,
   `slack`, `smtp`, `sqs`, `eventing`. A filename's first qualifier equals its
   tier folder.
6. **`rules/` is pure.** No clock, no I/O, no collaborator. Value types and
   the pure functions over them live here, not as `*Service` classes
   (`rules/monitor-platform-url.rules.ts`). Only a real named decision earns
   a rule; assembly stays in the service.
7. **The module class is thin forwarding.** `MonitorModule` builds services in its
   constructor from the repositories and forwards each `MonitorApi` operation
   (`app/monitor.app.ts`). Services and peers are `#private`; the public
   surface is exactly the API's operations. Logic in the class is a defect.
8. **Parse once, where a value enters untyped** (a transport, a channel's
   inbound message). After that it travels as its `z.infer` type. A Prisma
   repository does not re-parse columns Prisma already types (§3.2).
9. **Named parameters everywhere.** `fn({ a, b })`. `authorization` and scope
   are parameters, never `AsyncLocalStorage` (§3.2, ADR-166).
10. **Throw a `HandledError`**, never a `TRPCError`, when the cause is known
    and the caller can act (§12; `contract` skill). Anything else stays a
    plain `Error`.
11. **New record ids are KSUIDs** with the subject's resource prefix, name
    without hyphens (§3.2). `generate("monitor")` in `monitor.app.ts`.

## Worked example: adding a read

A new read on monitor (hypothetical), in order:

1. Operation on `MonitorApi` (`contract` skill, ask first).
2. Repository interface method in `repositories/monitor.repository.ts`.
3. Implement it in `prisma/prisma.monitor.repository.ts` (with `projectId` in
   the `where`) and `memory/memory.monitor.repository.ts`. Extend the contract
   test so both are held to it.
4. Service method in `services/monitor.service.ts`: the behaviour.
5. One forwarding line in `app/monitor.app.ts`.
6. Test beside it in a colocated `__tests__/` (`services/__tests__/`).

A decision (which window, which URL shape) with no I/O goes to a
`rules/<name>.rules.ts` (`monitor-performance-window.rules.ts`), a pure
function with its own unit test.

## Traps

- **A "helper" or "factory" under `services/` or `repositories/` that
  assembles collaborators.** That is composition in the wrong place; it moves
  into the module class's `create` (§5).
- **A service that calls another module's repository, or reaches a peer
  directly.** Peers arrive as narrow `Pick<PeerApi, ...>` slices handed in by
  the module class. How a peer is declared is the `module-dependencies`
  skill; do not invent a path.
- **A re-parse.** `monitor.service.ts` still parses its inputs after the
  transport has: the record says a service does not (§3.2). Do not copy it.
- **Behaviour in a transport or repository.** Both are thin; move it to a
  service or rule.
- **A new `*Api` operation, shim or chosen constant** is a design choice.
  Propose, do not write.
- **A catch-all `utils.ts` or a `Date.now()` in a rule.** Both are refused:
  the first by the grammar, the second by the rules purity check.
- **Deleted names.** `defineServerModule`, `*App` classes, `.withApp` and
  `<f>.server.ts` are gone (§15); write `defineProcessModule`, `*Module`,
  `.withApi` and `<f>.module.ts`. The other §15 spellings
  (`createProcess`, `withMemoryRepositories` in new code, `members:` options)
  are deleted. Existing tests under `app/__tests__/` still use some; copy the
  shape from §13, not those lines.

## Where next

REST and tRPC binding: `api-transports`. Pipelines, subscribers, schedules:
`eventing-and-worker`. Tests: `testing`. Peers, config, secrets, availability,
entitlements, peer cycles: `module-dependencies`. Review: `architecture-review`.
