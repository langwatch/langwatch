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
- `/path.md` for each page's Markdown copy action.
- Hashed JavaScript and CSS under `assets/`, fonts, posters and docs media.
- `search-index.json` with article text, navigation trails and headings.
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

```sh
pnpm exec tsc --noEmit -p docs/site/tsconfig.json
pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc docs/site
```

Generator tests, browser smoke tests and a built-site link check are the next
implementation phase. Behaviour scenarios live in `specs/`.
