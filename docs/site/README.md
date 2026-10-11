# LangWatch documentation site

The site renders the existing `docs/` MDX, navigation from `docs/docs.json`, and
operations from `docs/api-reference/openapiLangWatch.json` and
`docs/api-reference/openapi-evals.json`. Pages need no React route files. Only
pages listed in the navigation are published, including API operations.

Run these commands from the repository root, using the repository's Node and
pnpm versions. Install workspace dependencies with `pnpm install`. On a machine
without Playwright's Chromium, install it once:

```sh
pnpm --filter @langwatch/docs-site exec playwright install chromium
```

Chromium renders Mermaid to light and dark SVG during compilation. Diagrams do
not need JavaScript in the published site. Syntax highlighting also runs during
compilation. The initial star count uses GitHub's public API with a cached,
optional fallback; building requires no credentials.

## Develop

```sh
pnpm --filter @langwatch/docs-site dev
```

Open `http://localhost:5173`. Direct page URLs work. React mounts into the dev
HTML template, and Vite recompiles MDX and its imported snippets when they
change. Changes to MDX, navigation or either OpenAPI document reload the page;
changes to React components use React refresh. Search is generated from the
current navigation and source, so it works before a production build exists.
Invalid MDX shows Vite's error overlay and recovers when corrected.

The development server exposes a source search index without heading anchors.
The production index includes rendered article text and heading anchors.

## Build

```sh
pnpm --filter @langwatch/docs-site build
```

This command compiles the client and renderer, then prerenders every configured
page into `docs/site/dist`. It emits:

- `/path/index.html` for each page, plus the introduction at `/index.html`.
  Configured `section/index` pages also have a `/section` alias.
- `/path.md` for each page's Markdown copy action.
- Hashed JavaScript and CSS under `assets/`, fonts, posters and docs media.
- `search-index.json` with article text, navigation trails and headings.
- `llms.txt`, a directory of configured pages linking to their Markdown.
- `redirects.json` generated from `docs.json`.
- `404.html` with the documentation shell and recovery links.
- `skipped.json`, empty after a successful build.

A missing configured source, invalid MDX or rendering failure makes the command
fail. Do not publish output from a failed build. The temporary `dist-ssr` renderer
is removed on completion or failure. No authored MDX or OpenAPI files are changed.

## Preview

```sh
pnpm --filter @langwatch/docs-site preview
```

Open `http://localhost:4173`. Preview serves the last build and requires that port
to be free. `/integration/quick-start` and `/integration/quick-start/` both serve
`/integration/quick-start/index.html`. Configured redirects return 301 and retain
incoming query parameters unless the destination already supplies that key.
Unknown page routes return `404.html` with HTTP status 404. Malformed URL encoding
returns 400. These are the routing rules the production edge must implement.
Stop either local server with Ctrl+C.

## Components and validation

The shell, MDX components and API playground consume design-system exports;
docs-specific semantic tokens live in `src/theme.ts`. Raw legacy skill markup is
adapted during compilation. The current eight embedded product recordings have
no audio streams; the video renderer explicitly mutes these silent demonstrations.
Narrated media requires captions and a corresponding renderer before publication.

The docs ground uses the marketing site's blue, apricot and rust palette. The
centred paper, navigation rail and raised panels use separate semantic surfaces;
gradients stay behind the page. The ground is static, including under reduced
motion. The home recording starts only on request and has a local poster frame.
Its agent setup panel copies the full tracing prompt from `skills/directory.mdx`;
the picker changes the paste instructions, and the source remains in the MDX.
The compiler watches that source so edits also refresh the home panel in dev.

Potential design-system contributions are the layered documentation shell,
agent setup panel and compact announcement strip. They remain docs-local until
another surface needs the same behaviour.

```sh
pnpm exec tsc --noEmit -p docs/site/tsconfig.json
pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc docs/site
```

Behaviour scenarios live in `specs/`; generator tests are colocated in
`__tests__/`, and browser and link runners live in `scripts/`.

## Test without disturbing a running preview

The unit suite uses the repository's shared Vitest configuration. Run it through
the package script, with the usual worker limit:

```sh
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/docs-site test
```

Build an isolated artifact, then run the browser smoke and local link checks:

```sh
pnpm --filter @langwatch/docs-site build --out-dir "$TMPDIR/docs-test-dist"
pnpm --filter @langwatch/docs-site test:smoke --out-dir "$TMPDIR/docs-test-dist" --screenshots "$TMPDIR/docs-test-shots"
pnpm --filter @langwatch/docs-site test:links --out-dir "$TMPDIR/docs-test-dist"
```

The smoke runner starts its own preview on an available port, closes it and
Chromium in cleanup, and captures the introduction, quick start and trace API
page at 1440 and 390 pixels in light and dark. It checks clipboard copying,
keyboard search, API authentication validation, the complete page inventory,
redirects and 404 responses. API requests are intercepted; no real key is used.

The link checker checks every built HTML page, local link and fragment, following
configured redirects. It treats links to `docs.langwatch.ai` as local, skips
external destinations, writes `link-report.json` in the chosen output directory,
and exits non-zero for broken links. It has no exclusion list for content errors.

For a separate manual preview:

```sh
pnpm --filter @langwatch/docs-site preview --out-dir "$TMPDIR/docs-test-dist" --port 4175
```

`--out-dir` is resolved from the package directory; absolute paths avoid
ambiguity. Omitting it retains the normal `docs/site/dist` output. Preview still
defaults to port 4173, and fails if its chosen port is occupied.
