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

1. **Dependency direction, no exceptions.** apps -> `*-process` / `*-browser`
   -> `*-contract`. Browser never imports process. Process never imports
   browser. Contract imports no framework and no other half (§3).
2. **Another module imports only your contract** and names your `*Api` token.
   Never your service, repository, channel, table or browser package, even
   when the import resolves.
3. **One owner per subject.** `modules/catalogue.json` maps every subject to
   exactly one module. The owner serves the endpoints and runs the
   collection. A tRPC namespace belongs to one module (§3).
4. **A module is installed by editing the catalogue, never a root.** Add an
   entry, run `pnpm generate:modules`. It rewrites
   `packages/installed-server-modules/src/server-modules.generated.ts` (and
   the web twin). Never hand-edit a generated file. Uninstalling a module
   another one depends on fails to compile, naming the dependent (§5).
5. **Specs first.** `specs/*.feature` is the requirement. No scenario for your
   change: write one first, error paths included (CLAUDE.md, §13).
6. **A decision goes in `adrs/`**, with a row in its `README.md`. Comments stay
   at five lines; longer reasoning is an ADR.
7. **Package names are `@langwatch/<name>-contract|process|browser|client`**,
   all `private: true`, `"type": "module"`, source-resolved (`main` points at
   `./src/index.ts`). Copy `modules/monitor/*/package.json`.
8. **Process exports the installer and transport declarations, nothing
   else.** `modules/monitor/process/src/index.ts` is three lines. See
   `process-module`.
9. **A browser package exports `./declaration` and nothing else** (§3.4).
   See `modules/monitor/browser/package.json`.
10. **A folder past 30 source files groups into concerns**
    (`process/src/features/<concern>/`, `contract/src/features/<concern>/`,
    one level only; §3.4, ruled 2026-10-01). No module has landed it yet.
    The grammar already accepts it
    (`packages/oxlint-rules/grammar/feature-layout-policy.mjs`).

## Worked example: monitor (minimal)

`modules/monitor` is the smallest complete module. Read it in this order:

| Step | File | What it shows |
|---|---|---|
| 1 | `modules/catalogue.json` (entry `"monitor"`) | id, root, `classification`, `subjects` |
| 2 | `contract/src/monitor.api.ts` | the `MonitorApi` interface and token |
| 3 | `contract/src/monitor.errors.ts` | `HandledError` subclasses |
| 4 | `contract/src/monitor.trpc.ts` | every procedure declared once |
| 5 | `process/src/monitor.server.ts` | the installer: repositories, app, transports |
| 6 | `process/src/transport/monitor.{rest,trpc}.ts` | permission and handler per route |
| 7 | `process/src/repositories/` | interface, `prisma/`, `memory/`, registry |
| 8 | `process/src/services/monitor.service.ts` | behaviour over the repository |

For a module with eventing, channels and tasks read `modules/automation`. For
a module with many transports and contract files read `modules/organization`.
For a module with a `client/` package read `modules/dataset/client`.
(`modules/automation/README.md` is stale: it names `server/` and `web/`.)

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
- **Today's names differ from the target names** (`defineServerModule`,
  `*App`, `<f>.server.ts`). Write today's, and see §16 for the rename table.
  The §15 deleted spellings are never new code.
- **Peer cycles.** A module may not depend back on its dependent. Use events
  and a pending answer (§3, §17; `pnpm lint:architecture --list-policies`).

## Not here

What a module may demand of its process (peers, config slice, supply tokens,
members, entitlements): the future `module-dependencies` skill.
Composing a process (`main.ts`, boot): the future `process-composition` skill.
