---
paths:
  - "packages/oxlint-rules/**"
  - "packages/architecture-enforcer/**"
  - "packages/test-harness/**"
  - ".oxlintrc.jsonc"
---

# Lint and analysis tooling

Load the `lint-rule` skill to add or change a rule.

- oxlint `langwatch` plugin: rules registered in one `rules` map in
  `packages/oxlint-rules/src/index.mjs`, enabled at `error` with one config line
  each. Almost no rule has an autofixer, deliberately: the message's `fix` line
  says what to write. The generated reference is `dev/docs/lint-rules.md`
  (`pnpm --filter @langwatch/architecture-enforcer docs`).
- House rules are strict (§17): a disable naming a `langwatch/*` rule is an
  error, except on the few rules that opt in through `defineRule({ escape })`,
  and then only with a reason. A drift rule's message tells the agent why and
  what to use instead.
- `@langwatch/architecture-enforcer`: whole-tree policies (package boundaries,
  cycles, frontend/server separation, table ownership, memory-twin drift, dead
  exports) from one registry (`--list-policies`). No policy reads a baseline (two ruled transitions, §7's event-table access and
  §10.1's framework-module-contracts, hold shrink-only lists under
  `packages/architecture-enforcer/tests/baselines/`; every peer cycle is refused,
  §17); a policy whose anchor file is missing refuses the run by name. CI runs the zero-finding
  policies by id.
- TypeScript 7's root `typescript` export is a version constant. The compiler
  API lives behind `typescript/unstable/*`; sessions go through
  `packages/test-harness` (ADR-099; see `src/__tests__/typescript-compiler-api.unit.test.ts`).
