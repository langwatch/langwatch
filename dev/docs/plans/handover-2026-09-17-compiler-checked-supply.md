# Handover: the process supply becomes compiler-checked

**For a coordinator to run in lanes.** Written 2026-09-17 on
`feat/strict-feature-layout-v0`. Nothing in this drive is implemented; the design
is settled and measured.

Read first, in this order:

1. `dev/docs/adr/147-compiler-checked-process-supply.md` — the decision.
2. `specs/server/typed-process-supply.feature` — the behavioural contract, 16
   scenarios, every one tagged `@unimplemented` beside its binding tag. **A lane
   drops that tag on the scenarios it binds, in the commit that binds them** —
   leaving it on is how a green parity run comes to mean nothing.
3. `dev/docs/plans/typed-composition-builder.md` — the measurements, the rejected
   alternatives and why, and the implementation traps.

## The one-paragraph version

A module already declares everything it needs — the members it reads, the peers
it depends on, its own config shape — and `reads()` keeps those names as literal
tuples, so the module side is typed exactly. The process side throws it away:
`createApp({ role, config, members })` takes its config and members BEFORE
`.withModules(...)` says what will be installed, so nothing can be checked and
every mistake is a boot failure. This drive moves the check to the compiler. The
supply becomes a fluent chain, `boot()` takes no arguments, and the calls it
requires are computed from what was installed.

## Measured state, all verified

| | |
| --- | --- |
| module server barrels | **51**, exporting **2,775** names beyond their installer |
| …of those, imported anywhere outside their own module | **145** — so **2,630 (95%) delete with no consumer change** |
| largest barrels | trace **179**, automation 93, langy 85, identity 75, scenario 72, gateway 72 |
| modules exporting exactly one thing | **0 of 51** (median 15) |
| live `.withProvided(` call sites | **89** |
| files teaching the old shape (skills, ADRs, lints) | **16** |
| members `apps/api` passes explicitly | **1** (`eventing`) — the rest come from config |
| api module-config slices | 25, of which **23 reshape** rather than pass through |
| `moduleApi` declaration sites needing currying | ~50 |

Prototyped and verified against `tsc`: 15 failure modes on the app builder, 6 on
the door builder, 5 minimality cases, the facilities callback inferring what it
supplied, and the whole thing over a generated **49-module** graph in ~0.8s of
tsc work, naming every gap in one pass.

## The target

```ts
await createApp({ role: "api" })
  .withModules(serverModules)
  .withConfig(apiModuleConfig(config))
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withObservability((o) => o.withLogging(pino).withTracing(otel()).withMetrics(otel()))
  .withTransportAuth((a) => a
    .withStaticTokens({ cron, langyInternal, instanceAdmin })
    .withBrowserSession(session))
  .boot();
```

`apps/worker` is the same chain without `withTransportAuth`. That one call is the
entire difference between the roles.

## How to split Claude and Codex

**Codex** takes work that is a deterministic transformation with a written
exemplar and a mechanical check: codemods, renames, migrating N files to a shape
one file already demonstrates. **Claude** takes work where the answer is not yet
decided: type-level design, what a module may expose, resolving an identity
collision, the composition roots.

A Codex lane must never be started before its exemplar exists. Half of these
lanes are cheap precisely because an earlier lane wrote the one file they copy.

## The lanes

### L1 — the builder (Claude, opus, high) — BLOCKS EVERYTHING

`packages/runtime-composition`. Build the type state proven in the plan doc:
requirements accumulate from `withModules`, each `with*` subtracts, `boot()` is
callable only when nothing is outstanding.

Traps, both already hit in prototyping and written up:

- The state parameters **must** sit in a property position
  (`readonly __missing: Missing`). Phantom parameters occurring only in return
  types leave every state structurally assignable to every other — it compiles
  and enforces nothing.
- The per-module config intersection must be flattened through
  `type Simplify<T> = { [K in keyof T]: T[K] } & {}` or the error prints a
  forty-way intersection instead of a missing-properties list.
- `Record<never, never>` is `{}` and everything extends it; emptiness checks use
  `[keyof T] extends [never]`.

Gate: the prototypes in the plan doc, re-expressed as type tests in the package.

### L2 — `moduleApi` carries its id (Codex) — after L1

`node dev/scripts/codemods/moduleapi-curry.mjs [--write]` does it. Dry-run
measured **147 call sites across 104 files**, three times the estimate made by
reading — which is why the lane runs the script rather than a hand count.

`moduleApi<Api>(name)` erases the name, so peers cannot be subtracted. Curry it:
`moduleApi<ProjectApi>()("project")`. TypeScript will not infer `Id` while `Api`
is explicit, which is why it curries rather than taking two arguments.

Gate: `pnpm typecheck`; no behaviour change.

### L3 — one id, one API (Claude, opus) — after L2

`ActivatedLicenseSource` is `moduleApi<EntitlementSource>("licensing")` while the
licensing module's contract is `moduleApi<LicensingApi>("licensing")`. Two APIs,
one id. No runtime collision — a token's identity is the frozen object — but
`provide` is keyed by id and that is only sound while an id names one API. It
borrowed the id because `ModuleName` is a closed catalogue union with no other
legal name, so this is NOT a rename.

Decide: licensing provides it through installation, or it stops being a
`moduleApi` token and becomes a process-composed port in a category of its own.
Then write the lint that holds it.

### L4 — a module barrel exports its installer and nothing else (Claude decides the rule, Codex sweeps)

**This is the lane that fixes what the user actually reported: agents installing
modules their own way, in hacky ways.** There are 179 doors into `trace`. With one
export there is nothing to reach for, and everything else is reached by installing
the module and taking its app — including in tests, through the DI already built.

`node dev/scripts/codemods/barrel-consumers.mjs [module]` is the worklist, and it
makes the lane far smaller than it looks: of **2,775** surplus export names,
**145** are imported anywhere outside their own module. **2,630 delete with no
consumer change at all** — that part is mechanical and belongs to Codex.

The 145 are the real work and belong to Claude. Each is either a module that
should be installed, or a peer that should be `provide`d. Neither is a barrel
export. Run the script per module to list them by name.

Claude writes the rule and converts two modules as exemplars (one small, one of
the worst — `trace`, at 179 export statements). Codex sweeps the rest, module by
module, each its own commit.

Gate per module: `pnpm --filter @langwatch/<m>-server typecheck` and its suite;
then the consumers' packages.

### L5 — the supply vocabulary (Claude for the record, Codex for the sweep) — after L1

`ProcessMembers`'s fourteen become stores (relational, analytical, blobs,
keyvalue), channels (eventing, mail), facilities (logging, metrics, tracing,
clock), and root-level secrets and encryption. `cache`, `rateLimiter` and
`idempotency` stop being supplied — they are derived, the first two from the
key-value store and the third from the relational one plus encryption.

`telemetry` becomes `metrics` — it is `count()` and `observe()` and nothing else
— and `tracing` is added, because a module wanting a span currently has no
declared way to get one.

### L6 — composition roots (Claude, opus) — after L1, L2, L5

**Not codemoddable, and it was checked rather than assumed.** `apps/api` is 564
lines, 9 functions, no classes - the new chain replaces perhaps forty of them and
the rest is config resolution and member construction that survives.
`apps/worker` is **2,646 lines with 21 classes in a composition root**, of which
**15 are absence scaffolding** (`LoggedWorker*Absence`, `Absent*`) spanning 279
lines of class body and 116 lines of mentions. Those exist only to narrate a
graph that did not boot, and with one unconditional graph they have nothing to
report - but each still has a live call site today, so they die WITH this lane,
not before it. Deleting them is the mechanical half; deciding what replaces each
`options.absence?.withoutX()` is not.

`apps/api`, `apps/worker`, `apps/tasks`. Also lands the two reporting seams the
design requires and the current shape has nowhere to put: unknown config keys
**dropped and logged** by module and key, and a warning when a store is overridden
to memory while a real endpoint is configured.

Gate: both processes boot in their own harnesses.

### L7 — installation tests (Codex) — after L6

~40 files. Six are **currently broken**, calling `withInfrastructure` /
`withPersistence`, which no longer exist on the builder: they fail with
`createApp(...).withInfrastructure is not a function`. Four of those six cannot be
fixed under the present design at all — stored-object's used the removed seam to
inject in-memory storage, and `STORED_OBJECTS_BACKEND` accepts only `s3 | azure`.
This design fixes them, since `storage: memory` becomes expressible.

Claude writes one exemplar first; Codex follows it.

### L8 — documentation (Codex) — after L6

**40+ locations across `.claude/skills/`.** `composition-by-size.md` is built
entirely on the old shape and needs rewriting rather than editing. Also
`module/references/{new,convert,wire,extend}.md`, `architecture-guide/references/
{server,testing,contract}.md`.

The rule for this lane, and it is the whole rule: **documentation shows only the
shape that exists.** The spellings that no longer do live in the lint, never in
prose — a reference that lists them puts the deleted names in front of the next
reader.

### L9 — the lints (Claude) — LAST

Only now can the bans activate; `withProvided` alone has 89 live call sites, so
adding it earlier fails the build for every other session.

1. Add the deleted spellings to `banned-legacy-names`.
2. **One module id, one API** (from L3).
3. **A composition file imports installers, config and the builder — nothing
   else.** `private-runtime-export` polices what a module offers; this is the same
   boundary from the consumer's side. It is what would have stopped the worker
   hand-building persistence for modules it had already installed, which is how it
   grew eight graphs and forty-six stitches.

## Out of scope, and say so if asked

**`apps/ui` cannot take a `createApp` chain, codemod or otherwise**, because
there is no builder on that side to write one against. It is not on this shape and cannot be moved onto it here:
`modules/web-modules.generated.ts` reads "No module declares a web half yet" and
exports `[]`, so the catalogue path is unwired, and what runs is
`collectWebInstallations` over a hand-listed array merged with a legacy set, where
a `WebInstallation` is an imperative `install(ui)` rather than a declaration. Its
own drive.

## Traps in this checkout

Several sessions share this working tree and commit as the same git user.

- **Never `git add -A`, `git add .`, or `git add -- <directory>`.** Stage exact
  paths and print `git diff --cached --name-only` before every commit. During this
  session another session staged eight of its files into the shared index between
  two of my commands, and a third swept one of my uncommitted files into its own
  commit.
- **Never `git stash`.** Never revert or reformat a file another session is editing;
  check `git status --porcelain <path>` before touching one. `apps/worker` had 24
  uncommitted files from another session at the time of writing.
- `pnpm format` rewrites ~1300 unrelated files — use `pnpm exec oxfmt <your files>`.
- **Strip ANSI before grepping** (`| perl -pe 's/\e\[[0-9;]*m//g'`) or `error TS`
  is split by colour codes and you will read zero. This cost a wrong conclusion
  twice in one session.
- **zsh does not word-split `$var`**; **BSD sed has no `\b`**. Both fail silently.
- `pnpm exec` outside the workspace root fails with no output, which reads as
  "compiled clean" to a script checking for errors.
- Comment blocks are capped at 5 lines including the delimiters.
- Before blaming a failure on your own edit, check the commit before it.
