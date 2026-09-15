# Gates

The checks every task skill ends with. Run only the ones your change reaches, from the
repo root. Never run the root `pnpm typecheck`, `pnpm lint` or `pnpm format` from an agent
shell: each takes a machine-wide slot. Never boot `pnpm dev` to verify.

## Per package

```bash
pnpm --filter @langwatch/<pkg> test                       # the package suite
pnpm --filter @langwatch/<pkg> test:unit <path>           # one file (no extra `run`: the script already says it)
pnpm --filter @langwatch/<pkg> test:integration           # only packages whose vitest.integration.config.ts declares a datastore
pnpm --filter @langwatch/<pkg> typecheck                  # the package's own tsconfig
```

A rename or repoint has its own ladder, `.claude/skills/module/references/remap.md`: grep
every occurrence first, the package suites before and after, the package `typecheck`
and the `typecheck` of every workspace package that depends on it
(`pnpm --filter "...@langwatch/<pkg>" --filter "!@langwatch/platform-api" --filter "!@langwatch/worker" --filter "!@langwatch/ui" typecheck`),
the lint count for the rule you serve, and a last grep that prints nothing. Paste each.

Every workspace package declares `typecheck`, `test` and `test:unit`. Use the script, not
`exec tsc -p tsconfig.json`: the script names the right project, and the bin shim queues a
whole-tree `tsc` reached any other way. Package names: `@langwatch/<f>-contract`,
`-server`, `-web`; `@langwatch/platform-api` (apps/api), `@langwatch/worker`,
`@langwatch/ui`, `@langwatch/tasks`, `@langwatch/api`, `@langwatch/runtime-composition`,
`@langwatch/architecture-enforcer`.

Never `npx vitest`, never a hand-rolled vitest config, never `--maxWorkers=1`. After an
interrupted run, sweep with `pkill -f "vitest/dist/workers"`.

## Boundaries and specs

```bash
pnpm --filter @langwatch/architecture-enforcer lint
pnpm --filter @langwatch/architecture-enforcer check:feature-parity
pnpm --filter @langwatch/architecture-enforcer test:unit tests/frontend-boundary.unit.test.ts
```

`lint` runs the CLI in `packages/architecture-enforcer/src/cli.ts`; the oxlint half runs
separately over `.oxlintrc.jsonc`. Filter the CLI output to your module
(`grep "modules/<f>"`) and to the policies you care about; the full output is
thousands of lines while the burn-down is in progress. Read `check:feature-parity`'s
`✗ THIS RUN FAILS: …` banner, never a `grep -c`: a `✓ all bound` under one `▸` heading is
scoped to that file and says nothing about the run. See `.claude/skills/spec-bind/SKILL.md`.

## Registries, when you touched them

```bash
pnpm --filter @langwatch/ui test:unit tests/installed-ui-features.unit.test.ts tests/installed-ui-drawers.unit.test.ts tests/installed-ui-drawers.integration.test.tsx
pnpm --filter @langwatch/worker test:unit src/features/__tests__/worker-feature-catalogue.unit.test.ts
pnpm --filter @langwatch/worker test:unit src/app/__tests__/worker-capability-mount.composition.unit.test.ts
pnpm --filter @langwatch/runtime-composition typecheck      # regenerates nothing; fails if feature-names.generated.ts lags catalogue.json
```

## Style, on the files you changed only

```bash
pnpm exec oxlint --config .oxlintrc.jsonc <files>
pnpm exec oxfmt --write --disable-nested-config <files>
```

oxlint and oxfmt are the only linter and formatter. A repo-wide red is not your diff.
A comment block over five lines is flagged for review; keep comments short.

## Baselines

`*-baseline.json` in `packages/architecture-enforcer/src` (`boundary-edge`,
`composed-exports`, `feature-shape`, `oxlint`, `source-folder-shape`, plus
`comment-block-roots.json`; one shape, `{ version, policy, entries[{ key, measured }] }`) record pre-existing violations
and may only shrink. A new violation in a file you touched is yours to fix, not to add. Lanes never
edit a baseline; the root session regenerates it once the violation is gone (a stale
entry is itself reported). Diff the violation LIST before and after, not the total: a
wrong placement trades one violation for another.

`source-folder-shape` is the shape of the tree itself, everywhere under `apps/` and `packages/`:
a source folder holds at most 12 source files (a folder is one concept; past that a reader
stops seeing it), and a file under 20 lines read only by its own folder is a fragment of the
file that reads it. Its messages say where the code belongs. When you hit one, fold the code
into the file that owns the noun; when no file does, split the folder, never the file.

`feature-shape-baseline.json` is the conversion inventory: one entry per module and
kind, measured against annotation. Pieces annotation has no place for:
`contract-service`, `persistence-adapter`, `fixtures-directory`, `testing-entry`,
`nested-transport`, `legacy-transport-runtime` (a transport that still names
`createServiceApp`, `createServiceVersionedApp`, `createTrpcService`,
`createProjectVersionedApp`, `mountProjectTransport` or their kin instead of being
mounted by the process on the runtimes), `unregistered-repositories`,
`postgres-without-memory`, `nested-web-entry`, `refusing-composition`. Pieces of annotation a
module still lacks:
`no-installer`, `no-app`, `installer-not-booted`. A module is converted when it has no
entries left; `.claude/skills/module/references/convert.md` closes them kind by kind.
