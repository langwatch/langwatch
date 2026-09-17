# `sdks/typescript` build speed — measurement and proposed change

Target: the published `langwatch` package, the slowest single item in
`pnpm build`. Every number below came from a command run in this checkout on
2026-09-17. Nothing here has landed: `sdks/typescript/tsup.config.ts`,
`package.json`, `tsconfig.json` and `scripts/generate-evaluator-attachments.mjs`
were all dirty under another session, so the patch lives in
`.claude/handoffs/sdk-build-speed.md` under `Shared-file requests`.

## 0. How these numbers were taken (read this before quoting one)

The machine was under load average **130–212 on 10 cores** for the whole
session (other lanes). Identical commands varied **2–3x in wall clock**: the
same unmodified `tsup` run measured 9.28s, 11.91s, 17.57s, 43.19s and 62.27s.
Wall clock from this session is therefore not quotable as an absolute.

**User CPU seconds are stable to about 5%** across the same runs and are what
every headline below uses (`/usr/bin/time -p`, `user` field, whole process
tree). Wall clock is quoted only where the thing being measured is process
spawn rather than compute. Comparisons are always between runs taken in the
same window, interleaved where the difference was small.

Cold vs warm is stated per row. "Cold" means the output directory and any
`.tsbuildinfo` were removed first.

## 1. Where the time actually goes

`pnpm --filter langwatch build` is `prebuild` → `rm -rf dist && tsup` →
`postbuild`.

| Step | user CPU | wall | share of CPU |
|---|---|---|---|
| `prebuild` (`pnpm run generate`) | 0.23s of real work | 3.70 / 4.14 / 4.53s | — |
| `tsup`, all three configs | **20.77s** | 22.61s | 100% |
| — JS transpile, all three configs | 2.45s | 4.83s | **12%** |
| — library DTS (config 1) | 17.00s | 21.59s | **82%** |
| — agent DTS (config 2) | 3.30s | 5.16s | **16%** |
| `postbuild` | ~0.4s | ~0.5s | — |

Declaration generation is **88% of the build**. The transpile everyone assumes
is the cost is 12%.

The brief's 33.9s figure predates two edits that are already in the working
tree under another session: `build` used to begin with `tsc --noEmit`
(measured **4.86s user / 11.89s wall** on its own), and
`generate:openapi-types` used to re-run `openapi-typescript` unconditionally.
With those two already gone, today's build is ~21s CPU, not 33.9s. The levers
below are measured against that 21s, not against 33.9s.

### 1.1 The two DTS phases are two independent TypeScript programs

`tsup.config.ts` declares three configs. tsup gives each its own `dts` worker,
so the library entries and the agent entry are type-checked **twice over an
overlapping graph**: 17.00s + 3.30s = **20.30s CPU of declaration work**. One
`tsc` program covering the same six entry points costs 8.95s cold (§2). This is
the answer to "do the three entries duplicate work": for JS, no — 2.45s total
for all three. For declarations, yes, and it is most of the build.

## 2. The lever: `tsc --emitDeclarationOnly` instead of tsup's `dts`

Measured with a scratch `tsconfig` (`emitDeclarationOnly`, `incremental`,
`rootDir: src`, `src/cli/**` excluded, `declarationMap: false`):

| | user CPU | wall |
|---|---|---|
| tsup `dts` today (both configs) | **20.30s** | — |
| `tsc --emitDeclarationOnly`, cold | **8.95s** | 17.47s |
| `tsc --emitDeclarationOnly`, warm (unchanged inputs) | **3.04s** | 5.55s |

Whole pipeline, run end to end into the real `dist/` (tsup with `dts: false` on
all three configs, then `tsc -p tsconfig.dts.json`):

| | user CPU | wall |
|---|---|---|
| Baseline `tsup` | 20.77s | 22.61s |
| Proposed pipeline | **9.68s** | 16.81s |

**−11.1s user CPU, −53%.** `pnpm run postbuild` passed against that `dist`
(`postbuild: dist/cli/index.js ok (1.15.0)`).

### 2.1 The published surface was verified, not assumed

- All six `exports` map `types` targets exist and are non-empty after the
  proposed build: `dist/index.d.ts` (6,122 B), `dist/observability-sdk/index.d.ts`,
  `.../semconv/index.d.ts`, `.../setup/node/index.d.ts`,
  `.../instrumentation/langchain/index.d.ts`, `dist/agent/index.d.ts`. Plus the
  legacy `types`/`main`/`module` fields. `tsc`'s `rootDir: src` layout happens
  to reproduce the exports map path-for-path — no output-path mapping needed.
- A consumer probe (`node_modules/langwatch` symlinked to the real package, no
  `paths` overrides, `module`/`moduleResolution: nodenext`, `strict`) importing
  all five public subpaths type-checks **clean**, with `skipLibCheck: true`
  **and** with `skipLibCheck: false`.

### 2.2 What does change in the tarball — needs a release decision

| | today | proposed |
|---|---|---|
| `.d.ts` files | 20 | 181 |
| `.d.ts` bytes | 1,208,225 | 1,493,461 |
| `.d.mts` files | 20 | **0** |
| `.d.mts` bytes | 1,208,248 | 0 |
| declaration bytes shipped | 2,416,473 | **1,493,461 (−38%)** |

Two shape changes, both real:

1. **`.d.mts` disappears.** Nothing in `package.json` names a `.d.mts`
   (`grep -c 'd\.mts' package.json` → 0): every `exports` entry has a single
   condition-agnostic `"types"` pointing at a `.d.ts`, which is what TypeScript
   resolves for both `import` and `require` today. So the 1.2 MB of `.d.mts` is
   already unreferenced. **But** a tool that sniffs for a sibling `.d.mts` next
   to `dist/index.mjs` — notably `@arethetypeswrong/cli`'s masquerading checks —
   may grade the package differently. I could not run `attw` (no installs). This
   is the one item that needs a decision before release, not just a review.
2. **The internal module tree becomes visible as 161 extra `.d.ts` files.** The
   same types ship today, inlined into the bundle; they would now ship as
   separate files under `dist/internal/**`, `dist/client-sdk/**`. `files:
   ["dist"]` already covers them.

### 2.3 Two `.ts` specifiers leak into the per-file emit

`rewriteRelativeImportExtensions` (inherited `true`) rewrites 226 of 228
extension-bearing relative imports, but **not type-only ones**. Two survive
into the emitted declarations:

- `src/client-sdk/services/experiments/experiment.ts:41` — `} from "./types.ts";`
- `src/internal/generated/types/evaluator-attachments.ts:14` —
  `import type { SuiteFieldDefinition } from "./suite-fields.ts";`
  (generated; the `.ts` comes from the upstream
  `modules/scenario/contract/src/evaluator-attachments.ts:8`, and
  `scripts/generate-evaluator-attachments.mjs` does not rewrite it)

The consumer probe showed **0 errors** from either, with `skipLibCheck: false`,
so neither is on a reachable public type path today. They are still latent: one
new export makes them dangling relative imports in a published `.d.ts`. Fix both
in the same change (§5, items 4 and 5).

### 2.4 The warm number needs a separate decision

3.04s warm requires the `.tsbuildinfo` to survive between builds, and `build`
begins `rm -rf dist`. CLAUDE.md's rule is explicit that a `tsBuildInfoFile`
belongs beside the output and that clearing the output directory while leaving
the cache behind produces a build that emits nothing. So the proposal puts
`tsconfig.dts.tsbuildinfo` inside `dist/`, dies with it, and takes the **8.95s
cold** number. Getting 3.04s means replacing `rm -rf dist` with something
narrower, which is a correctness question about stale artifacts and is out of
scope here. Flagging it: **the remaining 5.9s CPU is behind that one decision.**

## 3. Levers measured and rejected

| Lever | Measured | Verdict |
|---|---|---|
| Treat the 1 MB generated OpenAPI types as external to the DTS bundle | 17.00s → **14.20s** CPU (−2.8s, −16%), and the emitted `index.d.ts` then carries a dangling `./internal/generated/openapi/api-client` import — tsup writes no per-file declarations, so the output is **broken** | Reject. The 1 MB file is *not* what makes DTS slow; it is 16% of it. The compiler still loads and checks `api-client.ts` to resolve the re-exported types, so externalising the *output* does not remove the *work*. |
| Generate the OpenAPI types as `.d.ts` directly | Bounded above by the 2.8s in the row above — a `.d.ts` input would be copied rather than emitted, but still type-checked | Reject. Bounded at ≤2.8s, needs every importer to be type-only, and §2's lever removes the bundler from the path entirely, which is where that 2.8s came from. |
| Drop CJS — declarations | dual-format DTS 17.00s vs ESM-only DTS **16.15s** = **−0.85s (5%)** | Reject. The type-check happens once; the second format is a re-print. |
| Drop CJS — transpile | all three configs dual 2.45s vs ESM-only **1.58s** = **−0.87s** | Reject **for this package**. |
| `isolatedDeclarations` | Forced on: **140 errors across 135 of 562 source files** (TS9010 ×103, TS9007 ×9, TS9008 ×7, TS9011 ×6, TS9016 ×4, TS9025 ×3, TS9013 ×2, TS9038 ×2, TS9009 ×2, TS9012 ×1). A/B on the same config, both non-incremental: **7.27s → 6.82s CPU, −6%** | Reject now, revisit never-unless. `tsc` itself barely speeds up; the flag pays off only with a separate syntactic emitter, which this repo does not have. Consistent with `typescript-tidy-projects.md` §10.6, which rules it out for internal packages and leaves published ones "arguable" — at 0.25 errors/file this package is far cheaper than `trace/contract` (15.7/file), but 140 hand annotations for 0.45s is not a trade. |

### 3.1 On dropping CJS specifically

Total bound for ESM-only today: **~1.7s of 20.77s CPU (8%)**. After the §2
lever it is ~0.87s of 9.68s, because `tsc` emits one `.d.ts` set regardless of
JS format. Against that:

- `"main": "dist/index.js"` plus a `"require"` condition on **all six**
  `exports` entries; no `"type": "module"`; `engines.node >= 22`.
- The CLI bundle is CJS **by construction** — the compile-cache stub tsup writes
  as `dist/cli/index.js` does `require("./bundle.js")` — so a CJS transpile pass
  happens either way.
- Consumers are external and uncountable from here.

CJS is load-bearing for this package; keep it. The lever is real for *internal*
packages the repo consumes itself (nothing in this repo `require()`s
`langwatch`), but those are not this package and not this lane.

## 4. `prebuild` — already incremental, but paying for three `pnpm` spawns

`prebuild` is `pnpm run generate` = `pnpm run generate:server-types && pnpm run
generate:openapi-types`.

| | wall (3 runs) |
|---|---|
| `pnpm run generate` | 3.70 / 4.14 / 4.53s |
| `./copy-types.sh && node scripts/generate-openapi-types.mjs` (identical work) | 0.50 / 0.62 / 0.60s |
| one bare `pnpm run` with no script | 1.85s wall / 0.51s user |

The work is **0.33s**: `copy-types.sh` 0.25s, `generate-openapi-types.mjs`
0.08s. Everything else is three nested `pnpm run` process spawns.

On incrementality, which the brief asked about:

- `scripts/generate-openapi-types.mjs` **is already cached** — it sha256s the
  OpenAPI document plus the patch script into
  `src/internal/generated/openapi/.fingerprint` and exits early on a match. That
  is why prebuild is ~4s and not the ~5s in the brief. (Its own comment names
  the gap: bumping `openapi-typescript` alone does not invalidate the stamp.)
- `copy-types.sh` is **not** cached and does not need to be: 0.25s for six
  copies and four small `node -e` codegen steps. A correct cache key would be a
  hash of its eight input files plus the script itself; it would save ~0.2s and
  add a stale-output failure mode. Not worth it.

So: collapse the nesting, cache nothing new. **−3.1 to −3.9s wall** (this is a
process-spawn measurement, so wall is the right unit; ~1.0s CPU).

## 5. The proposed change, as exact hunks

All five files are outside this lane's owned paths; four of the five are dirty.
These are requests, not edits.

**1. `sdks/typescript/tsup.config.ts`** — two hunks, `dts: true` → `dts: false`.

```diff
@@ config 1 (library entries)
     format: ["cjs", "esm"],
-    dts: true,
+    // Declarations come from `tsc -p tsconfig.dts.json` in the `build`
+    // script, not from the bundler: one program for all six entries instead
+    // of two, and 20.3s of CPU becomes 9.0s. See dev/docs/plans/sdk-build-speed.md.
+    dts: false,
     sourcemap: true,
```

```diff
@@ config 2 (agent entry)
     shims: true,
-    dts: true,
+    dts: false,
     sourcemap: true,
```

**2. `sdks/typescript/package.json`** — two hunks.

```diff
-    "generate": "pnpm run generate:server-types && pnpm run generate:openapi-types",
+    "generate": "./copy-types.sh && node scripts/generate-openapi-types.mjs",
```

```diff
-    "build": "rm -rf dist && tsup",
+    "build": "rm -rf dist && tsup && tsc -p tsconfig.dts.json",
```

**3. `sdks/typescript/tsconfig.dts.json`** — new file.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationMap": false,
    "composite": false,
    "rootDir": "./src",
    "outDir": "./dist",
    "incremental": true,
    "tsBuildInfoFile": "./dist/tsconfig.dts.tsbuildinfo"
  },
  "references": [],
  "include": ["./src/**/*.ts"],
  "exclude": [
    "./src/cli/**",
    "./src/**/__tests__/**",
    "./src/**/*.test.ts",
    "./src/**/*.test-d.ts"
  ]
}
```

`src/cli/**` is excluded because the CLI entry already builds with `dts: false`
and nothing public imports it; including it costs 13.24s cold instead of 8.95s
and 562 files instead of 181.

**4. `sdks/typescript/src/client-sdk/services/experiments/experiment.ts:41`**

```diff
-} from "./types.ts";
+} from "./types";
```

**5. `sdks/typescript/scripts/generate-evaluator-attachments.mjs`** — add one
rewrite so the generated file's type-only import loses its `.ts`, alongside the
two `.replace` calls already at lines 84–85:

```diff
-  .replace(evaluatorFieldsImport.pattern, evaluatorFieldsImport.inline.join("\n"));
+  .replace(evaluatorFieldsImport.pattern, evaluatorFieldsImport.inline.join("\n"))
+  // Type-only imports keep their `.ts` through `rewriteRelativeImportExtensions`,
+  // which would ship a dangling specifier in the emitted declaration.
+  .replace(/from "\.\/suite-fields\.ts"/g, 'from "./suite-fields"');
```

### Verification to run after applying

```bash
pnpm --filter langwatch build          # expect: postbuild: dist/cli/index.js ok (1.15.0)
node -e "const p=require('./sdks/typescript/package.json'),{existsSync}=require('node:fs');\
for(const [k,v] of Object.entries(p.exports)) if(!existsSync('sdks/typescript/'+v.types)) throw new Error(k)"
grep -rn 'from \"[^\"]*\.ts\"' sdks/typescript/dist --include='*.d.ts'   # expect: no matches
```

## 6. Found on the way, not part of the patch

- **`pnpm --filter langwatch typecheck` emits into the published output
  directory.** `tsconfig.json` sets `noEmit: false`, `declaration: true`,
  `declarationMap: true`, `outDir: "./dist"` and includes `**/*.ts`, so `tsc -b`
  writes `dist/src/**`, `dist/__tests__/**`, `dist/tsup.config.d.ts`,
  `dist/vitest.config.d.mts` and **902 `.d.ts.map` files** into `dist/`. Observed
  directly: a `rm -rf dist && tsup` left 20 declaration files, and a `typecheck`
  immediately after left 902 map files and a `dist/src/` tree. A `pnpm pack`
  between a typecheck and a build ships all of it. It also makes the two steps
  fight over one cache: `build`'s `rm -rf dist` deletes
  `dist/tsconfig.typecheck.tsbuildinfo`, so every typecheck after a build is
  cold. The `noEmit: false` comment in `tsconfig.json` says it exists "so a
  `tsc -p` build still writes its declarations" — §5's `tsconfig.dts.json` takes
  that job over, which frees `tsconfig.json` to go back to `noEmit: true`.
  Cost of the emit is **not separated** here: `tsc --noEmit -p tsconfig.json` is
  4.86s user and `tsc -b` is 30.52s user, but that gap also contains building
  the referenced `modules/langy/contract` project. Worth its own lane.
- Published `dist/index.d.ts` imports types from
  `@langwatch/langy-contract/cards/handled-error`, which is a **devDependency**
  — so the specifier cannot resolve from the tarball. This is true of today's
  tsup output as well as the proposed one; the change neither causes nor fixes
  it. Pre-existing, worth a separate look.

## 7. Summary

| Lever | Measured saving | Risk to published output | Needs the dirty config? |
|---|---|---|---|
| `tsc --emitDeclarationOnly` replaces tsup `dts` | **−11.1s CPU (20.77 → 9.68), −53%** | `.d.mts` stops shipping (unreferenced, but `attw` unverified); 161 internal `.d.ts` appear; declarations shrink 38% | yes — `tsup.config.ts` + `package.json` |
| Collapse `generate`'s nested `pnpm run` | **−3.1 to −3.9s wall**, ~1.0s CPU | none | yes — `package.json` |
| Fix the two `.ts` type-only specifiers | none (correctness) | removes a latent dangling specifier | no — two clean-ish files |
| Let the `.tsbuildinfo` outlive `rm -rf dist` | a further **−5.9s CPU** (8.95 → 3.04) | stale-artifact risk; needs a decision | yes |
| Drop CJS | −1.7s CPU (8%) today, −0.87s after lever 1 | breaks every `require("langwatch")` consumer | — rejected |
| OpenAPI types external to the DTS bundle | −2.8s CPU, output broken as measured | — | — rejected |
| `isolatedDeclarations` | −0.45s CPU (6%) for 140 annotations | — | — rejected |

## 8. Coordinator verdict: the `.d.mts` recommendation is reversed

The lane could not run `attw` and therefore reasoned about `.d.mts` from the
exports map alone: nothing names one, so they look like dead weight. I ran
`attw` against the real packed tarball, and the opposite is true. Today's
published package grades:

| | node10 | node16 (CJS) | node16 (ESM) | bundler |
|---|---|---|---|---|
| `langwatch` | ok | ok | **masquerading as CJS** | ok |
| the other five subpaths | **resolution failed** | ok | **masquerading as CJS** | ok |

`types` points at a `.d.ts`, and the package has no `"type": "module"`, so every
ESM consumer is handed CJS-flavoured types for an ESM file. The twelve `.d.mts`
files are not residue — they are **the unwired cure for that defect**. All six
entries already have one on disk.

Verified in a scratch copy of the real `dist/` (no repository file touched):
rewriting each export to condition-nested types,

```jsonc
"./observability": {
  "import":  { "types": "./dist/observability-sdk/index.d.mts", "default": "./dist/observability-sdk/index.mjs" },
  "require": { "types": "./dist/observability-sdk/index.d.ts",  "default": "./dist/observability-sdk/index.js"  }
}
```

turns **all six** `node16 (from ESM)` cells green, at **zero build cost** —
the files are already produced. The five `node10` failures are a separate
`typesVersions` gap and are not addressed by this.

### What this does to lever 1

`tsc --emitDeclarationOnly` emits `.d.ts` only. Adopting it as written would
delete the twelve `.d.mts` and make the masquerading defect **uncurable**
without reintroducing a second emit. The −53% is real and worth having, so the
lever survives with one addition: after the `tsc` pass, copy each emitted
entry `x.d.ts` to `x.d.mts` and wire both into the exports map as above. The
contents are identical — only the extension carries the module flavour, and
with ESM sources under `isolatedModules` there is no `export =` to invalidate
the copy.

Do **not** land lever 1 without that copy step.

### Sequencing

Every hunk in §5 still waits on the concurrent session holding
`tsup.config.ts`, `package.json` and `scripts/generate-evaluator-attachments.mjs`.
That session has already landed part of lever 2 independently: `tsc --noEmit`
is gone from `build`, and `generate:openapi-types` is now a script.

The exports-map fix is the one piece that is **independently valuable** — it is
a correctness fix for a shipped defect, needs no build change, and can land on
its own the moment `package.json` is free.
