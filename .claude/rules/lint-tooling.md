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
- `@langwatch/architecture-enforcer`: whole-tree policies (package boundaries,
  cycles, frontend/server separation, table ownership, memory-twin drift, dead
  exports) from one registry (`--list-policies`). No policy reads a baseline (two ruled transitions, peer-cycles and eventing-table-access, hold shrink-only lists under tests/baselines/, ARCHITECTURE.md §17); a policy whose
  anchor file is missing refuses the run by name. CI runs the zero-finding
  policies by id.
- TypeScript 7's root `typescript` export is a version constant. The compiler
  API lives behind `typescript/unstable/*`; sessions go through
  `packages/test-harness/src/ts-ast.ts` (ADR-099).
