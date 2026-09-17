# `@langwatch/ui` production build speed — measurement

Measured 2026-09-17 against `feat/strict-feature-layout-v0`, working tree as it
stood (`apps/ui/vite.config.ts` and `apps/ui/package.json` dirty, owned by
another session — nothing here was applied to them).

## Verdict first

**There is no material build-speed win available that does not change what the
build outputs.** Every input-size lever people reach for first — heavy
dependencies, barrel imports, module count, bundle bytes, minifier, target,
plugins — was measured, and every one of them is worth zero to noise. 26 % of
the build is sourcemap generation, and that is the only large lever; taking it
means shipping no sourcemaps. The one free change measured at 3 %.

The honest recommendation list is three lines long. It is at the bottom.

## Method, and why wall clock is not the metric

The machine ran at load average 85–240 on 10 cores throughout (other agents).
Wall clock for an unchanged build ranged **10.9 s to 36.8 s** across the
session; CPU time for the same build stayed inside ±0.4 s. So every number
below is **CPU-seconds (`user + sys` from `/usr/bin/time -p`)**, and every
comparison is **interleaved A/B** (base, variant, base, variant …) so that
machine drift cannot be read as a result. Absolute baselines drift between
blocks (15.0–18.4 CPU-s depending on machine state); only the within-block
delta is meaningful.

Baseline, `pnpm --filter @langwatch/ui build`, four consecutive runs, tree warm
(a prior `dist/` present, `node_modules` hot; no cold-cache run was measured):

| run | wall | vite's own "built in" | CPU |
| --- | ---- | --------------------- | --- |
| 1   | 25.6 s | 21.6 s | 18.4 |
| 2   | 29.9 s | 24.9 s | 18.3 |
| 3   | 22.6 s | 15.6 s | 18.3 |
| 4   | 16.0 s | 13.9 s | 18.4 |

The brief's "~7–8 s" is plausible on an idle machine — the best wall clock seen
here was 10.9 s — and the gap to 30 s is contention, not configuration. The
build is **main-thread-JS-bound**: parallelism is ~1.3 (18 CPU-s inside a 13 s
wall at best), so it neither uses idle cores nor tolerates a busy machine.

Toolchain: vite 8.1.2, bundler rolldown 1.1.3, default minifier `oxc`, default
target `baseline-widely-available`. `vite build --profile` is **not a flag on
this version** (absent from `--help`, produces no `.cpuprofile`); attribution
below is from `node --cpu-prof` on the vite entry plus config bisection.

Variants were measured through a probe config in `/tmp` that imports the real
`vite.config.ts` and overlays one field, so no repository file was edited for
any measurement. Probe passthrough reproduced the baseline exactly (17.45 vs
17.5 CPU-s), which is what makes the rest of the numbers comparable.

## Where the time goes

`node --cpu-prof`, one production build (23.9 s wall on the profiled run):

| bucket | self time | what it is |
| ------ | --------- | ---------- |
| idle | 8.1 s | main thread waiting on rolldown's Rust threads |
| `(program)` | 4.4 s | native / napi frames on the main thread |
| rolldown `bindingify-input-options` | 4.4 s | marshalling results across the napi boundary |
| vite `chunks/node.js` | 3.4 s | vite's own JS build pipeline |
| GC | 1.5 s | |
| `rmSync` | 0.5 s | emptying the previous 154 MB `dist/` |
| sass | 0.36 s | |

Top self-time functions are almost entirely sourcemap machinery:
`transformToRollupSourceMap` 1.67 s, `get map` 1.47 s, `originalPositionFor`
0.51 s, `addUneditedChunk` 0.46 s, `traceMappings` 0.26 s, `encode`/`decode`
0.44 s, `addSegmentInternal` 0.18 s, `remapping` 0.12 s — **≈5.2 s of JS
self-time composing and re-encoding sourcemaps**, once per emitted chunk, of
which there are 1385. Config bisection agrees independently: `--sourcemap
false` removes 4.3 CPU-s.

Our own vite plugins cost nothing: `designSystemStorybook` and `havenHmrGate`
are `apply: "serve"` and never run in a build, and removing
`patchObjectInspectBrowserStub` (an unfiltered `resolveId`) together with the
`manualChunks` JS hook measured **0** (17.07/17.42 vs 16.96/16.83). Plugin hook
dispatch totals 95 ms in the profile.

## Input size

Output of one production build: **41.1 MB JS across 1385 chunks, 109.3 MB
sourcemaps, 53 KB CSS, 2840 files, 154 MB total**. The module graph, recovered
from the emitted sourcemaps, is **8858 modules / 76.8 MB of source**.

Heaviest contributors (source bytes in the graph):

| KB | modules | package |
| -- | ------- | ------- |
| 15557 | 506 | `@shikijs/langs` |
| 8909 | 192 | `modules/analytics` (7.9 MB of it one file, `vega-lite-schema-validator.generated.js`) |
| 5886 | 6 | `react-icons` (md 2.1 MB, fa6 1.7 MB, fa 1.3 MB, lu 774 KB) |
| 3589 | 737 | `modules/trace` |
| 2829 | 130 | `@shikijs/themes` |
| 2745 | 65 | `mermaid` |

### Heavy browser dependencies: clean, with one latent seam

Checked against the graph by module path, not by grep of source:
`elevenlabs` **0 modules**, `grpc` 0, `ffmpeg` 0, `@opentelemetry/sdk-node` 0,
`sdk-trace-node` 0, `@aws-sdk` 0, `nodemailer` 0, `pino` 0, `undici` 0,
`@google/genai` 0 (not declared anywhere in the workspace). The other session's
removals have landed. Three ElevenLabs *URL strings* remain in
`assets/src-hPi9mBWw.js`; those are our own code, not an SDK.

The latent seam: `apps/ui/src/features/simulations/ui/voice/transports/elevenlabs-convai.client.ts:7`
still holds a **static** `import { Conversation } from "@elevenlabs/client"`,
and `voice-transport-client.registry.ts:8` statically imports that file.
Neither is reachable from the app entry today, so neither is in the graph — but
one reachable import puts `@elevenlabs/client` **and its `livekit-client`
dependency (1.37 MB unminified ESM)** into the eager graph. `@elevenlabs/client`
is also declared in `devDependencies` of `apps/ui` while being imported by
production browser source. See the proposed hunk below.

### A real duplicate, worth fixing for size — not for speed

`modules/gateway/web/package.json:48` pins `"shiki": "^3.15.0"` where
`packages/design-system` and `modules/onboarding/web` use `catalog:` (`^4.3.0`).
The browser graph therefore carries **two complete copies of shiki** —
`@shikijs/langs@3.23.0` *and* `@shikijs/langs@4.3.0`, plus two
`@shikijs/engine-oniguruma` each with its own 608 KB inlined wasm. Measured
redundancy: **343 duplicated module identities, 10.1 MB of redundant source,
22 MB of output** (stubbing the v3 copy took `dist/` from 154 MB to 132 MB).

Its build-time value is **zero** — see the table. Its value is bundle size.

## Every lever, measured

Interleaved A/B unless noted. Negative = faster.

| lever | ΔCPU-s | Δ% | verdict |
| ----- | ------ | -- | ------- |
| `build.sourcemap: false` | **−4.3** | −26 % | the only large lever; changes output |
| `output.sourcemapExcludeSources: true` | −0.73 | −4.8 % | keeps maps, drops embedded sources |
| `build.reportCompressedSize: false` | −0.48 | −3.0 % | **free** — no output change |
| react-icons barrels replaced by export-name-preserving stubs (−5.9 MB) | −0.47 | −2.6 % | noise-level; reject |
| `vega-lite-schema-validator.generated.js` stubbed (−7.9 MB, one module) | −0.2 | ~0 | noise; reject |
| shiki v3 duplicate removed (−230 modules, −10.1 MB source, −22 MB output) | **0** | 0 | reject *for speed* |
| drop custom `resolveId` plugin + `manualChunks` JS hook | 0 | 0 | reject |
| `--configLoader bundle` instead of `runner` | −0.15 | ~1 % | noise; reject |
| `advancedChunks.minSize: 30000` | 0 | 0 | did not merge (1385 → 1404 chunks); reject |
| `NODE_OPTIONS=--max-semi-space-size=64` | −0.11 | ~0 | noise; reject |
| `build.minify: false` | **+1.5** | +9 % | minifying is *cheaper* than writing the bigger output it avoids |
| `build.target: "es2022"` | +1.7 | +10 % | reject |
| `build.target: "esnext"` | +1.0 | +6 % | reject |

Notes on the rejected ones, because the reasons are the interesting part:

- **Minifier choice is not a lever.** `oxc` (the default) is already in use, and
  turning minification off makes the build *slower*, because the sourcemap and
  write phases then handle far more bytes. Terser was not measured; there is no
  reason to reach for it.
- **Target is not a lever, in either direction.** Both a lower target (`es2022`)
  and a higher one (`esnext`) measured slower than the default
  `baseline-widely-available`. The repo declares no `browserslist` and no
  `build.target`, so there is no support policy to trade against — and nothing
  to gain by trying.
- **Input size is not a lever at this scale.** Removing 22 MB of output and 230
  modules of shiki grammar saved exactly nothing. Cost tracks per-chunk
  sourcemap work and rolldown's own bundling, not bytes or module count.
- **Chunk count (1385) is the multiplier, and it is not reducible from config.**
  `advancedChunks.minSize` did not merge anything, because the chunks are
  dynamic-import entry points (lazy routes, shiki grammars), which rolldown will
  not fold together.

## Two invalid measurements, recorded so nobody repeats them

An early probe stubbed modules with `export default {}`. For `react-icons` that
produced 441 missing-export errors and **the build aborted**, yielding an
apparent "−3.55 CPU-s (−20 %)" saving that was simply a build that stopped
before rendering. The re-measurement with export-name-preserving stubs (which
completes) gave −0.47. Any probe that removes a module must be checked for exit
status and output completeness before its number is believed.

## Recommendations

1. **Apply `build.reportCompressedSize: false`.** −0.48 CPU-s (3 %), measured,
   no change to any emitted byte. It only costs anything at `--logLevel info`,
   which is the level `apps/ui`'s own `build` script runs at, so the saving is
   real for the script people actually run. This is the whole free win.
2. **Decide sourcemaps, do not change them silently.** `build.sourcemap: false`
   is −4.3 CPU-s (26 %) and −109 MB of output. Today
   `infra/docker/Dockerfile:222` copies all of `apps/ui` into the runtime image,
   so those 109 MB of maps ship and are served in production; no sourcemap
   upload step exists in any workflow. Whether that is deliberate is a product
   decision, not a build one. The middle option is
   `output.sourcemapExcludeSources: true`: −0.73 CPU-s, keeps line mapping,
   drops the embedded sources that make up most of the 109 MB.
3. **Fix the shiki duplicate for size, not for speed.** One line in
   `modules/gateway/web/package.json`. Note it requires a lockfile update, so it
   cannot land without an install.

And the thing with the largest effect on how long a build *feels*: it is
main-thread-bound at parallelism ~1.3, so two concurrent builds on this machine
cost more wall clock than every lever in the table put together. That is a
scheduling matter (`dev/scripts/check-queue.mjs` governs typecheck, not vite
builds), not a config one.

## Proposed diff hunks

None of these were applied. The first two touch a file another session owns.

### 1. `apps/ui/vite.config.ts` — free win (recommended)

```diff
     build: {
       outDir: "dist/client",
       sourcemap: true,
+      // Gzipping 1385 chunks for the size report costs ~3% of the build and
+      // tells us nothing the asset table doesn't. Measured 2026-09-17.
+      reportCompressedSize: false,
       rollupOptions: {
```

### 2. `apps/ui/vite.config.ts` — sourcemaps, needs a decision

Either (26 %, drops maps entirely):

```diff
     build: {
       outDir: "dist/client",
-      sourcemap: true,
+      sourcemap: false,
```

or (4.8 %, keeps maps, drops the embedded sources):

```diff
         output: {
+          // Maps keep their mappings; the 109 MB of embedded sources go.
+          sourcemapExcludeSources: true,
           manualChunks(id: string) {
```

### 3. `modules/gateway/web/package.json:48` — bundle size, not speed

```diff
-    "shiki": "^3.15.0",
+    "shiki": "catalog:",
```

Requires `pnpm install` to regenerate `pnpm-lock.yaml`; the Docker build uses
`--frozen-lockfile`, so the two must land together.

### 4. `apps/ui/src/features/simulations/ui/voice/transports/elevenlabs-convai.client.ts` — latent, zero cost today

```diff
-import { Conversation } from "@elevenlabs/client";
 import type {
```

```diff
   async openCall({ signedUrl, handlers }: { … }): Promise<VoiceCallSession> {
+    // Loaded at call time: the SDK drags livekit-client (1.37 MB) with it, and
+    // nothing before the first voice call needs either.
+    const { Conversation } = await import("@elevenlabs/client");
     const conversation = await Conversation.startSession({
```

Our whole use of the SDK is three calls (`Conversation.startSession` with six
callbacks, `endSession`, `getInputVolume`), so a lazy import is a two-line
change. Two things it is *not*: a "types-only" import — `startSession` does
microphone capture, audio worklets, VAD and PCM playback, so dropping the SDK
means owning that, not just the WebSocket; and a case for a lighter SDK —
`@elevenlabs/client` is already the browser-side package, and the alternative
official one is the server SDK. The same change should move
`@elevenlabs/client` from `devDependencies` to `dependencies` in
`apps/ui/package.json`, since production browser source imports it.

## Reproducing any of this

```bash
# baseline, CPU-seconds is the metric, interleave A and B
cd apps/ui && /usr/bin/time -p env NODE_ENV=production \
  ../../node_modules/.bin/vite build --configLoader runner --logLevel error

# phase attribution
NODE_ENV=production node --cpu-prof --cpu-prof-dir=/tmp/prof \
  ../../node_modules/vite/bin/vite.js build --configLoader runner

# module graph inventory: parse dist/client/**/*.map, aggregate
# sources[]/sourcesContent[] by package
```
