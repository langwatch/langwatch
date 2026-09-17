# The real-browser test lane

Most component tests belong in jsdom. This lane is for the assertions jsdom
cannot answer, and it costs roughly an order of magnitude more per file, so it
is a decision rather than a default.

## When it earns its keep

Reach for a real browser when the thing you are asserting **is the engine**:

- **Layout** — a two-line clamp, an overflow, an element's measured size.
  jsdom reports zero for every box, so a clamp test there asserts nothing.
- **Canvas and WebGL** — Vega, charts, anything that draws rather than lays out.
- **Pointer and scroll** — real hover, real `scrollIntoView`, real focus order.
- **Content-Security-Policy** — whether code survives without `unsafe-eval`.

Everything else — props in, DOM out, a mocked boundary — stays in jsdom.

## Adding the lane to a package

```ts
// vitest.browser.config.ts
import { defineBrowserVitestConfig } from "@langwatch/test-harness/vitest-browser-config";

export default defineBrowserVitestConfig();
```

```jsonc
// package.json
"scripts": {
  "test:browser": "playwright install --with-deps chromium && vitest run --config vitest.browser.config.ts"
},
"devDependencies": {
  "@vitest/browser-playwright": "catalog:",
  "playwright": "catalog:",
  "vitest-browser-react": "catalog:"
}
```

Name test files `*.browser.test.tsx`. That suffix is the whole contract: the
shared jsdom builder excludes it, the browser config collects it, and
`run-package-suites.ts` runs the script off the manifest — so declaring
`test:browser` *is* being in CI. There is no list to add yourself to.

**The lane installs its own browser**, in its own script — note the
`playwright install` ahead of `vitest` above. That is not decoration. There is
no `playwright` at the repo root, so an install orchestrated from there falls
through to whatever is on `PATH`: a different version, whose browser build the
lane then cannot find. Only the owning package resolves the right one.

Keeping it in the script also means the lane needs nothing from whatever runs
it — `pnpm -r`, the suite runner, or a developer typing it directly all work,
and a failed install fails the script through `&&` rather than being a warning
nobody reads. `--with-deps` installs the system libraries CI needs and is a
silent no-op on macOS, so one spelling is correct everywhere.

**Keep the files inside the package's tsconfig `include`.** Vite 8 transforms
with oxc, which reads JSX settings from the tsconfig covering each file — a
browser test outside `include` fails with `Tsconfig not found` before a single
assertion runs. `analytics-web` keeps its lane in `tests/`, so its tsconfig
names `tests/**` alongside `src/**`; a lane under `src/` needs nothing extra.
(The config sets no `esbuild` option: under Vite 8 oxc wins and esbuild options
are ignored with a warning.)

`packages/architecture-enforcer/tests/browser-test-lane.unit.test.ts` enforces
the rest, and `specs/ci/browser-test-lane.feature` is what it binds to.

## Do not import jest-dom here

`@vitest/browser` ships the jest-dom matcher set itself — `toBeInTheDocument`,
`toBeVisible`, `toHaveClass`, `toHaveAttribute` and the rest are already there.
A browser-lane file importing `@testing-library/jest-dom` registers a second
copy of matchers it has. **The jsdom lane still needs the import**, because the
matchers come from `@vitest/browser`, not from vitest — deleting it there
removes the matchers outright.

## Two ways to write the test

`vitest-browser-react` is the package vitest's own scaffolder points React at.
Its `render()` returns retrying locators and cleans up on its own, and it
deliberately exposes no `act`.

`@testing-library/react` also works inside the browser, and the existing tests
use it. If you keep it, keep this in mind: **RTL's `screen` queries are
synchronous, and a real browser is not.** Both pre-existing failures this lane
surfaced on its first real run were that race — an assertion reading a value the
engine had not finished writing:

```ts
// Races: Vega draws the bars before the host flips its status attribute.
expect(chartView()).toHaveAttribute("data-chart-status", "ready");

// Retries until it is true, or fails having actually waited.
await expect.poll(() => chartView()?.getAttribute("data-chart-status")).toBe("ready");
```

Anything the engine computes — layout, paint, an attribute written by a
library — needs `expect.poll`, `expect.element`, or a locator. Reserve the bare
synchronous assertion for values React wrote during the render you awaited.

## There is no codemod

Nothing automates `@testing-library/react` → vitest browser mode, and the reason
is not that nobody has written one. `screen.getByRole(x)` returns an element;
`page.getByRole(x)` returns a retrying locator. A codemod that adds `await` at
every call site produces tests that pass because the retry hides the assertion,
which is worse than the race it replaced. `trivikr/vitest-codemod` is
Jest → Vitest and irrelevant here; `vitest init browser` only scaffolds a new
config.

So migrate a file when you have a reason to — a race, a layout assertion jsdom
was faking — and not in bulk.
