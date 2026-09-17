# React Compiler in `apps/ui` — measured, and the decision

**Decision: adopt gated, not all-at-once.** Ship the `react/react-compiler` lint
rule now (it is native oxlint, costs 2.6 s, and needs no new dependency at all);
put the compiler itself in `compilationMode: "annotation"`, which measured as
free. Do **not** turn on full compilation at these versions.

The two headline numbers:

| | measured |
| --- | --- |
| Build-time cost of full compilation | **+173 s** on a **10.5 s** baseline build (≈ 17x) |
| Bail-out census | **606 bail-outs** against 4,548 functions compiled (11.8 %) |

Everything below comes from a command run on this checkout on 2026-09-17, in a
scratch tree at `/Users/lw/.claude/jobs/4790ebf4/tmp/rc7`. No workspace file was
edited and nothing was installed into the workspace.

## 1. What the toolchain actually supports

Read from `node_modules`, not from the internet:

| package | resolved version |
| --- | --- |
| `react` / `react-dom` | 19.2.8 |
| `vite` | 8.1.2 — real `vite`, **not** a `rolldown-vite` alias; it depends on `rolldown@~1.1.3` directly |
| `@vitejs/plugin-react` | 6.0.3 |
| `@vitejs/plugin-react-oxc` | **absent, and not needed** |
| `babel-plugin-react-compiler` | absent (1.0.0 is current) |

`@vitejs/plugin-react@6` *is* the oxc plugin. It has no `@babel/core`
dependency; JSX and Fast Refresh go through Vite's built-in oxc transform. The
separate `@vitejs/plugin-react-oxc` package is not part of this toolchain.

There is therefore exactly **one** integration path at these pins, and the
plugin states it in its own `peerDependencies` (`@rolldown/plugin-babel`,
`babel-plugin-react-compiler`, both optional) and its README: a `reactCompilerPreset`
helper exported from `@vitejs/plugin-react`, run through `@rolldown/plugin-babel`.
There is no rolldown-native or oxc-native React Compiler at 1.1.3 / 1.78.0.

`react/compiler-runtime` resolves inside react 19.2.8, so the separate
`react-compiler-runtime` shim is not needed.

### The `@babel/core` 8 trap — this one is load-bearing

`@rolldown/plugin-babel@0.2.4` accepts `@babel/core` `^7.29.0 || ^8.0.0-rc.1`,
and the README says `npm install -D @babel/core`, which today resolves 8.x.
**That combination is broken.** Measured, same census, same files:

| `@babel/core` | bail-outs |
| --- | --- |
| 7.29.7 | 569 |
| 8.0.5 | 1,366 |

The extra 797 are all one diagnostic —
`(BuildHIR::lowerAssignment) Expected object property value to be an LVal, got: AssignmentPattern`
— which fires on **every** `function Foo({ a = 1 })`. Minimal repro confirmed it
on a four-line component. Cause: the compiler calls `NodePath.isLVal()`, which
comes from `@babel/core`'s traverse, and Babel 8 removed `AssignmentPattern`
from the `LVal` alias. The compiler's own nested `@babel/types@7.29.8` is not
what runs that check.

So `@babel/core` must be pinned `^7.29.0`. The repo already has `@babel/core@7.29.7`
in its pnpm store transitively, so this adds no new major.

## 2. Build-time cost, measured

Production build of `apps/ui`, `NODE_ENV=production`, scratch `outDir` and
`cacheDir` so the real `dist/client` was never touched. Runs were interleaved
A/B/A/B to cancel drift. **Machine load average was 86–125 on 10 cores
throughout** (three other agent sessions were compiling); absolute numbers are
inflated, the ratio is the trustworthy part.

| variant | runs (warm) |
| --- | --- |
| baseline, no compiler | 10.0 s, 10.5 s, 13.7 s, 18.2 s (cold first run: 40.7 s) |
| compiler, `node_modules` + `.generated` excluded | 183.0 s, 185.1 s, 196.4 s |
| compiler, README default filter (no `id` filter) | 297 s, 303 s |
| compiler, `compilationMode: "annotation"` | 9.3 s, 13.1 s |

Three things follow.

**The README's default preset compiles your dependencies.** `reactCompilerPreset`
sets only `rolldown.filter.code`, never `filter.id`, so babel ran over **9,539**
modules — 4,538 first-party and ~5,000 out of `node_modules` — for zero extra
compiled components (success/error counts were byte-identical with and without
them). That is ~110 s of pure waste. Any adoption must set
`filter.id.exclude`.

**Even correctly filtered, the cost is ~173 s.** That is inherent, not
configuration: it is 4,538 JS-thread babel parses in a build whose whole speed
story is that transforms are Rust. Isolated, the pass costs **99.8 s of CPU over
3,516 files ≈ 28 ms per file**, single-threaded. It will not be tuned away; it
goes away when the compiler stops being a babel plugin in this pipeline.

**Annotation mode is free.** 9.3 s and 13.1 s against a 10.0–18.2 s baseline —
indistinguishable. The `"use memo"` code filter matches nothing today (0 files in
the tree carry the directive), so babel is never invoked.

### Dev server

`ready in` was unaffected: 512 ms / 738 ms baseline, 2,574 ms baseline again,
738 ms with the compiler — all noise at this load. First transform of 40
representative component modules fetched over HTTP: baseline 7.4 s and 22.5 s,
compiler 69.4 s. The baseline spread makes the multiplier unreliable; the number
to plan against is the isolated **28 ms of babel per file**, which is the
per-edit HMR tax.

### Shipped bytes

Clean rebuild of both, `.js` output only:

| | raw | gzip -9 |
| --- | --- | --- |
| baseline | 41,111,812 B | 8,878,128 B |
| compiled | 43,478,674 B | 9,801,902 B |
| delta | **+5.8 %** | **+10.4 %** |

Memoization is not free at runtime either — it is cache slots and comparisons
that have to be shipped.

## 3. Correctness over this codebase

Census run over 3,783 first-party source files (`apps/ui/src`,
`packages/design-system/src`, `packages/api-client-web/src`, all 35
`modules/*/web/src`), excluding tests, stories and `.d.ts`. 3,516 matched the
preset's code filter. With `@babel/core@7.29.7`:

- **4,548 functions compiled successfully**
- **606 bail-outs** (11.8 %)
- 0 skips, 0 pipeline errors, 0 crashes

Grouped by reason (build-run figures):

| count | reason |
| --- | --- |
| 230 | Cannot access refs during render |
| 113 | React Compiler skipped this component because React ESLint rules were disabled |
| 67 | Existing memoization could not be preserved |
| 40 | Use of incompatible library |
| 36 | `TryStatement` with a `finally` clause |
| 24 | value blocks inside `try`/`catch` |
| 14 | `TryStatement` without a `catch` |
| 16 | Rules-of-Hooks violations (3 kinds) |
| 66 | long tail — 20 further reasons, ≤ 8 each |

### The repo patterns the brief asked about

**`form.watch()` vs `useWatch` is enforced by the compiler.**
`babel-plugin-react-compiler` ships a named rule for `react-hook-form`: only the
`watch()` function returned by `useForm()` is incompatible, and a component that
calls it is skipped wholesale. That is the entire "Use of incompatible library"
bucket — 40 sites in 38 files, against 109 files that import `react-hook-form`.
The house rule in `CLAUDE.md` becomes machine-checked.

**Hooks returning state + callbacks compile cleanly.** No bail-out category
corresponds to the pattern, and the `*-host.tsx` files (the URL-routed drawer
singletons' hosts) appear only under "Existing memoization could not be
preserved" — an explicit `useMemo`/`useCallback` the compiler declined to
rewrite, not a behaviour change.

**Zustand and Chakra/Ark produced no bail-out category of their own.**

**Behaviour risk lives in what compiled, not in what bailed.** A bail-out leaves
the component exactly as written, so the 606 are safe by construction. The
residual risk is in the 4,548 that compiled — the identity-instability and
module-scope cases. The lint rule surfaces the candidates:

- `Globals` (6) — reassigning variables declared outside the component. All 6
  are in `__tests__` files, so nothing shipped.
- `Purity` (5) — `modules/langy/web/src/ui/sections/langy-empty-state.tsx`,
  `modules/ops/web/src/features/foundry/ui/sections/preset-picker.tsx`.
- `StaticComponents` (10) — `modules/project/web/src/ui/blocks/tech-stack.tsx`,
  `modules/user/web/src/ui/sections/devices-panel.tsx`,
  `modules/evaluator/web/src/ui/sections/checks/evaluation-manual-integration.tsx`,
  `modules/trace/web/src/ui/sections/explorer/search-bar/suggestion-dropdown.tsx`.
- `Immutability` (19) — `modules/presence/web/src/use-tab-session-id.ts`,
  `modules/auth/web/src/ui/elements/password-input.tsx`,
  `modules/scenario/web/src/ui/sections/agent-testing/run/use-run-dialog-form.ts`,
  `modules/prompt/web/src/ui/elements/outputs/outputs-section.tsx`.
- `ErrorBoundaries` (1) — `apps/ui/src/features/licensing/ui/sections/licensing-slots.tsx`.

Densest files overall:
`modules/trace/web/src/behavior/explorer/trace-drawer/drawer-header/use-retained-trace-header.ts` (15),
`modules/trace/web/src/ui/sections/explorer/hooks/use-trace-facets.ts` (15),
`modules/prompt/web/src/ui/sections/prompts/prompt-editor-drawer.tsx` (14).

## 4. The lint rule: oxlint already has it

`eslint-plugin-react-compiler` never reached stable — latest is `19.1.0-rc.2`,
superseded by `eslint-plugin-react-hooks@7`. Neither matters here, because the
repo has no eslint in the JS/TS lint path and does not need one:

**`react/react-compiler` is a real, working rule in the installed
`oxlint@1.78.0`.** It is in `configuration_schema.json` alongside
`react/exhaustive-deps` and `react/rules-of-hooks`, under the `react` plugin
that `.oxlintrc.jsonc` already enables. Measured over the whole web surface
(`apps/ui/src`, `packages/design-system/src`, `packages/api-client-web/src`,
all `modules/*/web/src`):

**706 diagnostics across 414 files, in 2.6 s.**

By category: Refs 213, EffectSetState 210, Suppression 117, PreserveManualMemo 84,
Hooks 21, Immutability 19, EffectDerivationsOfState 12, StaticComponents 10,
CapitalizedCalls 6, Globals 6, Purity 5, UseMemo 2, ErrorBoundaries 1.

This is the guardrail, and it needs **zero** new dependencies — no babel, no
compiler package, no build cost. 706 is too many to ship at `error` in one go;
it is a baseline-then-shrink job, the same shape the repo already runs for its
other rules.

## 5. Recommendation and rollout

1. **Now, free:** turn on `react/react-compiler` in `.oxlintrc.jsonc` at `warn`
   and baseline the 706. This alone catches the `form.watch()` misuse, the
   setState-in-effect cascades and the refs-during-render reads, with no
   dependency and no build cost.
2. **Now, free:** add the compiler in `compilationMode: "annotation"` with the
   `filter.id` exclusions. Measured at 9.3–13.1 s against a 10.0–18.2 s
   baseline. Individual hot components opt in with `"use memo"` at roughly
   40 ms of build each, and the cost stays proportional to what actually opted
   in.
3. **Not yet:** full compilation. +173 s on a 10.5 s build is not a tuning
   problem, and it lands directly against the build-speed work in flight. Revisit
   when the compiler is reachable without routing every module through a
   JS-thread babel parse, or when the 706 findings are down and the case for
   paying it is stronger than the 10.4 % gzip increase.

Why not `"use memo"`-free all-at-once with a directory gate: a directory gate
does not reduce the babel parse cost proportionally the way the annotation code
filter does — the filter is a regex over source, so an unannotated file is never
parsed at all. Annotation gating is strictly cheaper than path gating here.

## 6. What to verify after it lands

The riskiest compiled surfaces, and the suites that already cover them:

| surface | suite |
| --- | --- |
| trace explorer facets and retained header (densest lint findings) | `pnpm --filter @langwatch/trace-web test` |
| prompt editor drawer (14 findings, drawer navigation stack) | `pnpm --filter @langwatch/prompt-web test` |
| react-hook-form screens (38 incompatible-library files) | `pnpm --filter @langwatch/annotation-web test`, `pnpm --filter @langwatch/authz-web test`, `pnpm --filter @langwatch/dataset-web test` |
| drawer singletons / `*-host.tsx` (66 preserved-memo sites) | `pnpm --filter @langwatch/ui test` |
| virtualized tables (identity-sensitive rows) | `pnpm --filter @langwatch/dataset-web test` |
| end to end | `pnpm --filter @langwatch/ui test:e2e` |

Add one build-time assertion to whatever guards build duration, so a later
flip from `annotation` to `all` cannot land silently.

## 7. Exact config changes

All four target files were dirty when this was written, so these are requests,
not edits. They are reproduced verbatim in
`.claude/handoffs/react-compiler.md` under `Shared-file requests`.

`pnpm-workspace.yaml` (catalog, alphabetical), `apps/ui/package.json`
(`devDependencies`), `apps/ui/vite.config.ts` (import + one plugin) and
`.oxlintrc.jsonc` (one rule).
