---
name: module
description: "What a LangWatch module is and how to start one: the four packages (contract, process, browser, client), modules/catalogue.json, pnpm generate:modules, the specs/ and adrs/ folders, the dependency direction between halves, and what another module may import. Use when someone says 'new module', 'add a module', 'where does this feature live', 'which half does this go in', 'module anatomy', 'install a module', 'can I import from another module', 'split this out of X', or opens modules/<name>/."
user-invocable: true
---

# A module

Record: `dev/docs/ARCHITECTURE.md` §3 (what a module is), §3.4 (browser half),
§14 (worked examples). This skill teaches the shape and the traps. It does not
restate the rulings: follow the links.

A module is **an isolated microservice in one folder**. Other code sees its
contract and calls its `*Api` token. Nothing else.

```
modules/monitor/
├── adrs/        decisions (README.md index + NNN-slug.md)
├── specs/       Gherkin: the requirements (monitor-service.feature, ...)
├── contract/    @langwatch/monitor-contract   shared by everyone
├── process/     @langwatch/monitor-process    the half the api/worker install
├── browser/     @langwatch/monitor-browser    PRIVATE, the half the UI installs
└── client/      @langwatch/<name>-client      OPTIONAL: data others read in a browser
```

Enterprise modules mirror this exactly under `enterprise/modules/` (§3, §11).

## Rules that matter

Each rule lives in the record or CLAUDE.md; this table only points at it.

| Rule                                                                                    | Record       |
| --------------------------------------------------------------------------------------- | ------------ |
| Dependency direction: apps -> process/browser -> contract, never sideways               | §3           |
| Others import only your contract and call your `*Api` token                             | §3           |
| One owner per subject, mapped in `modules/catalogue.json`                               | §3           |
| Install by catalogue entry + `pnpm generate:modules`; never hand-edit a generated list  | §1, §5       |
| Specs first, error paths included                                                       | CLAUDE.md    |
| Decisions in `adrs/` with a README row; comments five lines max                         | CLAUDE.md    |
| Package names, `private`, source-resolved `main`: copy `modules/monitor/*/package.json` | (convention) |
| Process exports the installer and transports only (`process-module`)                    | §3.2         |
| Browser exports `./declaration` only                                                    | §3.4         |
| Past 30 source files, group into `features/<concern>/`, one level                       | §3.4         |

## Worked example: monitor (minimal)

`modules/monitor` is the smallest complete module. Read it in this order:

| Step | File                                           | What it shows                                         |
| ---- | ---------------------------------------------- | ----------------------------------------------------- |
| 1    | `modules/catalogue.json` (entry `"monitor"`)   | id, root, `classification`, `subjects`                |
| 2    | `contract/src/monitor.api.ts`                  | the `MonitorApi` interface and token                  |
| 3    | `contract/src/monitor.errors.ts`               | `HandledError` subclasses                             |
| 4    | `contract/src/monitor.trpc.ts`                 | every procedure declared once                         |
| 5    | `process/src/monitor.module.ts`                | the installer: repositories, module class, transports |
| 6    | `process/src/transport/monitor.{rest,trpc}.ts` | permission and handler per route                      |
| 7    | `process/src/repositories/`                    | interface, `prisma/`, `memory/`, registry             |
| 8    | `process/src/services/monitor.service.ts`      | behaviour over the repository                         |

For a module with eventing, channels and tasks read `modules/automation`. For
a module with many transports and contract files read `modules/organization`.
For a module with a `client/` package read `modules/dataset/client`.

## New module checklist

1. Spec first: `modules/<name>/specs/<name>.feature`.
2. Copy `modules/monitor/{contract,process}/{package.json,tsconfig*.json,vitest*.ts}`
   and rename. Add the browser half only if there is UI.
3. Write the contract (`contract` skill), then the process half
   (`process-module` skill).
4. Add the catalogue entry, run `pnpm generate:modules`, and
   `pnpm sync:references` (new workspace packages).
5. Prove it with an installation test through the real createApp chain
   (`modules/monitor/process/src/app/__tests__/monitor-installation.unit.test.ts`).
6. Scoped checks only, then `pnpm --filter @langwatch/<name>-process typecheck`.

## Traps

- **Reaching into a peer** because the import resolves. Ask for an `*Api`
  operation instead; adding one is a design choice, so propose it.
- **Putting a shared component or hook in a "kit" or shared browser package.**
  Kits are deleted (§3.4, §15). Shared UI goes to `packages/design-system`,
  shared data to a `<name>-client`.
- **A contract `package.json` naming a runtime** (`prisma-client`,
  `clickhouse-client`, `redis-client`, `eventing`, `group-queue`, `process-*`).
  The `manifests` policy refuses it (§3).
- **A second `feature.json` or a hand-edited generated list.** The catalogue
  is the one map.
- **Old spellings are deleted** (`defineServerModule`, `*App` classes,
  `<f>.server.ts`; §15). Write `defineProcessModule`, `*Module` and `<f>.module.ts`.
- **Peer cycles.** A module may not depend back on its dependent. Use events
  and a pending answer (§3, §17; `pnpm lint:architecture --list-policies`).

## Not here

What a module may demand of its process (peers, config, supply, entitlements;
§3.3) and composing a process (`main.ts`, `boot()`; §4, §5): `backend`.
