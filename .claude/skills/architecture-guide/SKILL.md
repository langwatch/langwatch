---
name: architecture-guide
description: The LangWatch architecture as ruled 2026-09-17 - process supply, module shape, transport and error law. Read before composing a process, writing a module, or citing any older shape.
---

# LangWatch architecture guide

Rewritten 2026-09-17. **Everything this skill taught before that date was
measured against the tree and found stale; do not trust any earlier copy.**

## Authority order

1. `.claude/coordinator/ARCHITECTURE-LAW.md` - the operative one-page law.
2. `dev/docs/adr/147-compiler-checked-process-supply.md` (server) and
   `dev/docs/adr/148-declared-browser-supply.md` (browser).
3. Today's decisions in `.claude/coordinator/LANES.md` (numbered; newest wins).
4. The enforcement is the linter, not prose: file grammar lives in
   `packages/oxlint-rules/grammar/feature-layout-policy.mjs` and
   `packages/architecture-enforcer/`. When prose and a rule disagree, the rule
   is the truth and the prose is the defect.

On conflict, the newest user ruling wins; report the conflict.

## The process supply (the kernel)

`@langwatch/kernel` owns composition. One entry point for tests and
production alike; `boot()` takes no arguments and is callable only when
everything the installed modules declared has been supplied. An absent supply
is a compile refusal (`MissingSupply<...>` names the outstanding set), never a
runtime fallback, never a logged absence.

```ts
// apps/api/src/app/api-production.composition.ts (the shape, abridged)
await createApp({ role: "api" })
  .withModules(serverModules)
  .withConfig(apiModuleConfig(config))   // one slice per module name
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withRelational(prisma)                // postgres in production, memory in tests
  .withAnalytical(clickhouse)
  .withKeyvalue(redis)
  .withEventing(eventing)
  .withObservability((o) => o.withLogging(pino).withTracing(otel()).withMetrics(otel()))
  .withTransportAuth((a) => a
    .withStaticTokens({ cron, langyInternal, instanceAdmin })
    .withBrowserSession(session))
  .boot();
```

- Supplies are the **closed member vocabulary** (`process-supply.types.ts`).
  Storage is declared, not wired. No bespoke per-module bags.
- Module id and supply token are two key spaces: the licensing module owns id
  `licensing`; the supplied source is token `licenseSource`, provided with
  `.provide({ licenseSource })`.
- `serverModules` is generated from `modules/catalogue.json`
  (`pnpm generate:modules`, `@langwatch/installed-modules/server`). Installing
  a module edits the catalogue, never a root. The generated `createServerApp`
  owns the chunked chain TypeScript's instantiation depth forces; no
  hand-written file names a chunk.

## The process shape (apps/*)

A process is an **entrypoint plus ONE composition file**. Transport hosting
(REST, tRPC, SSE), static serving, error formatting, lifecycle and the HTTP
listener are the kernel's job, opened by `boot()` from module declarations -
never per-process host files. Feature code never lives under `apps/*`.

The process boundary - signals, fatal handlers, ordered teardown - is
`Server` from `@langwatch/process-server`. Telemetry and config resolve
before it, so a config parse failure is logged and traced:

```ts
const secrets = await SecretEnvironmentService.create({ source: process.env }).resolve();
const config = resolveApiConfig(secrets.environment);
configureLogger({ ...loggerConfigurationFrom(config), redactPaths: secretLogRedactPaths() });
const server = Server.create({ name: config.serviceName, logger, shutdownDeadlineMs });
const runtime = await createApp({ role: "api" })/* the chain above */.boot();
server.host({ name: "api runtime", start: () => runtime.start(), stop: () => runtime.stop() });
await server.listen();
```

The worker is the same shape with `role: "worker"` and `drain: true` on its
hosted runtime; a module declares its jobs and subscriptions on its own
declaration, and per-domain worker composition files are gone. The browser
boot target is `@langwatch/ui-kernel` (`createUi`, `defineWebModule`); new
work must not deepen the older `uiFeature`/`WebInstallation` generations.

## Module server shape

- Root `index.ts` exports the **installer only** - transports, config and
  supplies hang on the installer; services, repositories and channels never
  leave the package.
- The installer: `defineServerModule("<f>").withRepositories(...).withApp(<F>App).withTransports(...)` -
  no `.build()`, every `with*` result is installable.
- A module declares its own config schema; the process hands it a validated
  slice keyed by module name. Module code never reads `process.env`.
- Repositories: interface + BOTH backends (prisma AND memory) offered through
  the registry seam; the process supplies `relational` as postgres or memory.
  A module never wraps itself to pick its backend.
- What a module needs beyond the closed vocabulary it **derives itself** from
  what it is supplied, or takes from a peer by `*Api` token in
  `static dependencies` - never a bespoke injected bag, never a `reads` static.

## Transport law

- Transport files declare routes/procedures ONLY; every wire schema imports
  from the module's OWN contract. Sanctioned exception: the `moduleApi<X>()`
  app-port interface a door declares for its own app.
- REST routes declare `withInput`/`withOutput`; the framework parses,
  validates, refuses, serialises. Handlers return plain values or THROW.
- No `readJsonBody`/`JSON.parse`/`c.json`/manual status branches on the
  standard JSON path. `RestErrorHandler` is banned outright.
- `publicRoute`/`RestRawResult` only for genuinely non-JSON protocols and the
  documented `*-legacy.rest.ts` family, each with a one-line reason.

## Errors

Throw `HandledError` only when the cause is known AND the caller can act;
everything else stays a plain `Error` and degrades to unknown + trace id.
Codes live in `packages/handled-error/src/app-codes.ts` with copy in
`presentation.ts`; tests assert on `code`, never message prose.

## Deleted spellings

Deleted, not deprecated. Reading one in a file marks conversion debt; writing
one new is a defect: `createProcess`, `withProvided`, `withMemoryRepositories`,
`membersFrom`, `reads(...)` statics, the `members:` option on `createApp`,
`withInfrastructure`, `withPersistence`, process-side `withTransports`,
absence classes (`Logged*Absence`, `Absent*`), `ApplicationBuilder`'s public
surface, per-process host files, hand-projected per-module config files,
`RestErrorHandler`, re-exports for backwards compatibility.

## References

- `references/composition-by-size.md` - the root assembled, at three sizes.
