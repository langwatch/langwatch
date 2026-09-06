# Gates

The checks every task skill ends with. Run only the ones your change reaches, from the
repo root. Never run the root `pnpm typecheck`, `pnpm lint` or `pnpm format` from an agent
shell: each takes a machine-wide slot. Never boot `pnpm dev` to verify.

## Per package

```bash
pnpm --filter @langwatch/<pkg> test                       # the package suite
pnpm --filter @langwatch/<pkg> test:unit run <path>       # one file
pnpm --filter @langwatch/<pkg> typecheck                  # the package's own tsconfig
```

Every workspace package declares `typecheck`, `test` and `test:unit`. Use the script, not
`exec tsc -p tsconfig.json`: the script names the right project, and the bin shim queues a
whole-tree `tsc` reached any other way. Package names: `@langwatch/<f>-contract`,
`-server`, `-web`; `@langwatch/platform-api` (apps/api), `@langwatch/worker`,
`@langwatch/ui`, `@langwatch/tasks`, `@langwatch/api`, `@langwatch/architecture-lint`.

Never `npx vitest`, never a hand-rolled vitest config, never `--maxWorkers=1`. After an
interrupted run, sweep with `pkill -f "vitest/dist/workers"`.

## Boundaries and specs

```bash
pnpm --filter @langwatch/architecture-lint lint
pnpm --filter @langwatch/architecture-lint check:feature-parity
pnpm --filter @langwatch/architecture-lint test run tests/frontend-boundary.unit.test.ts
```

`lint` runs the CLI in `packages/architecture-lint/src/cli.ts`; the oxlint half runs
separately over `.oxlintrc.architecture.json`. Read `check:feature-parity`'s
`✗ THIS RUN FAILS: …` banner, never a `grep -c`: a `✓ all bound` under one `▸` heading is
scoped to that file and says nothing about the run. See `../../spec-bind/SKILL.md`.

## Registries, when you touched them

```bash
pnpm --filter @langwatch/ui test run tests/installed-ui-features.unit.test.ts tests/installed-ui-drawers.unit.test.ts tests/installed-ui-drawers.integration.test.tsx
pnpm --filter @langwatch/worker test run src/features/__tests__/worker-feature-catalogue.unit.test.ts
pnpm --filter @langwatch/worker test run src/app/__tests__/worker-capability-mount.composition.unit.test.ts
```

## Style, on the files you changed only

```bash
pnpm exec oxlint --config .oxlintrc.architecture.json <files>
pnpm exec oxfmt --write --disable-nested-config <files>
```

oxlint and oxfmt are the only linter and formatter. A repo-wide red is not your diff.

## Baselines

`*-baseline.json` in `packages/architecture-lint/src` (`boundary-edge`,
`overengineering`, `port-module`, `service-quality`, `typed-prisma-seam`) record
pre-existing violations and may only shrink. A new violation in a file you touched is
yours to fix, not to add. Diff the violation LIST before and after, not the total: a wrong
placement trades one violation for another.
