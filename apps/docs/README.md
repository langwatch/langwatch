# LangWatch documentation site

The application lives in `apps/docs/`; authored pages, navigation and media stay
in `docs/`. The build produces a plain static directory, with no
application server, database or API required. React and the shared design system
render at build time; browser interactions load only their small islands.

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

Open `http://localhost:5173`. Direct page URLs work. The server renders complete
HTML, and Vite recompiles MDX and its imported snippets when they change.
Changes to MDX, navigation or either OpenAPI document reload the page;
interactive React islands use React refresh. Search is generated from the
current navigation and source, so it works before a production build exists.
Invalid MDX shows Vite's error overlay and recovers when corrected.

The development server exposes a source search index without heading anchors.
The production index lists each rendered article word once, with the pages it appears on, plus heading anchors.

## Build

```sh
pnpm --filter @langwatch/docs-site build
```

This command compiles the client and renderer, then prerenders every configured
page into `apps/docs/dist`. It emits:

- `/path/index.html` for each page, plus the introduction at `/index.html`.
  Configured `section/index` pages also have a `/section` alias.
- Identical `/path.md`, `/path.claude` and `/path.agent` content exports.
- Hashed JavaScript and CSS under `assets/`, fonts, posters and docs media.
- `search-index.json` with each article word written once with the pages it appears on, navigation trails and headings, plus
  lossless `.br` and `.gz` variants for hosts supporting precompressed delivery.
- `llms.txt`, a directory of configured pages linking to their Markdown, and
  `llms-full.txt`, every page's Markdown in reading order.
- `sitemap.xml` dated by each page's last commit (no dates from a shallow clone,
  so the deploy checkout needs full history), plus `robots.txt` and `agents.txt`.
- `redirects.json` and noindex redirect pages for exact source paths from `docs.json`.
  On a host without redirect rules, the 404 page resolves pattern sources such as
  `/guardrails/:path*` from `redirects.json` in the browser.

Canonical, sitemap and export addresses name `https://langwatch.ai/docs`, where the
docs are served today (`docs.langwatch.ai` redirects there). Production builds that
mount at that address use `--base-path /docs`.

- `404.html` with the documentation shell and recovery links.
- `skipped.json`, empty after a successful build.

A missing configured source, invalid MDX or rendering failure makes the command
fail. Do not publish output from a failed build. Each renderer uses its own temporary
directory under the system temporary root (`TMPDIR` when set), removed on completion
or failure. Builds with different output directories do not share renderer output.
No authored MDX or OpenAPI files are changed.

The build caches rendered pages by their compiled inputs and combines their styles
in navigation order. Renderer threads are bounded by available cores and memory.
`--render-workers 1` selects one renderer; `--no-render-cache` disables cache reuse.
An unchanged complete output is checked by content and reused without rebuilding.
Caches live under `apps/docs/node_modules/.cache/docs-site` and are disposable.

To emit URLs under a mount while retaining production canonical URLs:

```sh
pnpm --filter @langwatch/docs-site build --base-path /docs --out-dir "$TMPDIR/docs-mounted"
pnpm --filter @langwatch/docs-site preview --base-path /docs --out-dir "$TMPDIR/docs-mounted" --port 4175
```

Haven's docs lane builds this mounted artifact and serves it natively at
`app.<slug>.langwatch.localhost/docs/`. With a full stack, all other app routes
still reach the app. `haven up --only docs` runs only the static docs server;
both the app and docs hostnames open `/docs/`. Use the Vite command above for
authoring with hot reload; Haven serves the compiled output.

## Preview

```sh
pnpm --filter @langwatch/docs-site preview
```

Open `http://localhost:4173`. Preview serves the last build and requires that port
to be free. `/integration/quick-start` and `/integration/quick-start/` both serve
`/integration/quick-start/index.html`. Configured redirects return 301 and retain
incoming query parameters unless the destination already supplies that key.
Unknown page routes return `404.html` with HTTP status 404. Malformed URL encoding
returns 400. These are the routing rules a future static host must implement.
Stop either local server with Ctrl+C.

## Source ownership

`src/app/` composes pages, theme and the reading shell. `src/features/` owns
content, code, navigation, API reference, discovery, search, releases
and shell behavior. A feature uses `compile/` for Node build work, `model/` for
portable values, `ui/` for React and `browser/` for client enhancements as needed.
There is no module installer or dependency injection pipeline.

`src/site/` owns the static build, prerenderer, preview and Vite plugins;
`vite.config.ts` delegates to the same configuration used by build commands.
`src/site/document.ts` defines lazy browser entries and the document template seams.
`src/browser/` holds the small navigation bootstrap. Build paths and CLI options are in
`src/paths.ts`; browser environment configuration stays in `src/config.ts`.

The compiler and UI use strict TypeScript. Node 24 runs the typed build tools
without a second loader. Dependency versions come from the workspace catalog.
The Oxc React Compiler optimizes docs React components on the browser path;
shared design-system sources are reused without recompiling them. Complete pages
render at build time. Only interactive React islands need a browser runtime.

## Components and validation

The shell, MDX components and API playground consume design-system exports;
docs-specific semantic tokens live in `src/app/theme-config.ts`. Raw legacy skill markup is
adapted during compilation. The current eight embedded product recordings have
no audio streams; the video renderer explicitly mutes these silent demonstrations.
Narrated media requires captions and a corresponding renderer before publication.

The docs use the langwatch.ai brand: flat white paper (ink in dark mode), Sentient
headings, Inter body text, JetBrains Mono code and the orange accent. The navigation
rail and raised panels use separate semantic surfaces. The home recording starts only on request and has a local poster frame.
Its agent setup panel copies the full tracing prompt from `skills/directory.mdx`;
the picker changes the paste instructions, and an expandable preview shows exactly
what is copied. The source remains in the MDX.
The compiler watches that source so edits also refresh the home panel in dev.

Potential design-system contributions are the layered documentation shell,
agent setup panel and compact announcement strip. They remain docs-local until
another surface needs the same behaviour. The docs also disable drawer and dialog
animations under reduced motion; that behaviour is a design-system candidate.

```sh
pnpm --filter @langwatch/docs-site typecheck
pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc apps/docs
```

Behaviour scenarios live in `specs/`; unit and SSR tests are colocated with their
owner under `src/**/__tests__/`. Browser runners live in `scripts/`; the typed
link checker lives in `src/site/`.

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
Additional regressions exercise the agent picker, full authored prompt copying,
mobile navigation and focus restoration, diagrams with JavaScript disabled, and
video failure followed by a successful retry. Clipboard rejection is injected at
the browser API boundary to exercise the visible recovery state deterministically.
Clipboard controls stay disabled in prerendered HTML until their handlers are ready.
Every browser context and temporary server closes even when an assertion fails.

The link checker checks every built HTML page, local link and fragment, following
configured redirects. It treats links to `docs.langwatch.ai` as local, skips
external destinations, writes `link-report.json` in the chosen output directory,
and exits non-zero for broken links. It has no exclusion list for content errors.

For a separate manual preview:

```sh
pnpm --filter @langwatch/docs-site preview --out-dir "$TMPDIR/docs-test-dist" --port 4175
```

`--out-dir` is resolved from the package directory; absolute paths avoid
ambiguity. Omitting it retains the normal `apps/docs/dist` output. Preview still
defaults to port 4173, and fails if its chosen port is occupied.

## Static artifact and CI

`.github/workflows/docs-site.yml` installs dependencies, typechecks,
tests, builds and checks the site, then uploads the `apps/docs/dist` artifact.
It has no cloud deployment job or credentials. Build output contains no
host-specific edge code. A future deployment belongs in GitHub Actions.

Any static host can serve the directory. Configure directory-index routing,
a real 404 status for `404.html`, Markdown content types for `.md`, `.claude`
and `.agent`, and the desired cache headers. Exact redirects have refresh pages
with a canonical destination and a link usable without JavaScript. Existing pages
take precedence. Pattern redirects need hosting rules; they remain in
`redirects.json`. Preview tests HTTP redirects and query preservation separately.

Keep old hashed assets long enough for cached documents to finish loading their
lazy chunks. Revalidate mutable HTML and search files; immutable hashed
assets can use a long cache lifetime. A file is hashed when its name carries its
content hash: Vite's `assets/name-<8 characters>.ext`, or `name.<12 hex>.ext` for
the media the build publishes (`isHashedFile` in `src/site/hashed-assets.ts`).
The build publishes only the authored images, videos and posters a page or agent
export names, under hashed names: screenshots as AVIF and WebP at 840 and 1680px,
videos as AV1 WebM and H.264 MP4 with a WebP poster (ffmpeg, cached in
`node_modules/.cache/docs-media`). Logos, the favicon and the social card keep
their names, with a short cache lifetime. These are hosting requirements, not cloud
configuration emitted by the compiler. The existing Mintlify release workflow
and DNS cutover remain separate decisions.

## Static-first performance

Pages are complete HTML with build-extracted, content-hashed design-system CSS.
MDX and highlighting do not ship to readers. The bootstrap adds navigation and
lazy controls. Search and contextual menus load the shared design-system runtime
on interaction; reading and the API island do not need that runtime.
See [Revision 4: performance](./DESIGN.md) for the boundaries and alternatives.

Deferred reading enhancements prefetch internal links after deliberate hover or
focus, with at most two requests in flight and a small viewport allowance. Offline
and save-data readers do not trigger speculative requests.
Navigation preserves the header and handles history, focus and announcements.
A build change or a failed transition falls back to a normal document navigation.
The dev server renders the same static page structure and reloads authored MDX.

The site installs no service worker and has no offline mode. The search index is fetched
as `search-index.json?v=<build>`, so HTTP caches never serve an old index.

```sh
pnpm --filter @langwatch/docs-site size --out-dir "$TMPDIR/docs-performance"
pnpm --filter @langwatch/docs-site test:performance --out-dir "$TMPDIR/docs-performance"
pnpm --filter @langwatch/docs-site test:layout --out-dir "$TMPDIR/docs-performance" --screenshots "$TMPDIR/docs-layout"
```

`size` fails above 3 KB gzipped for initial reading and above 15 KB for the bootstrap, inline theme setup, idle
controls combined. It separately reports the full search and
playground interaction costs, including shared React/Zod. `test:performance`
checks static reading, navigation, prefetch and credential isolation. `test:layout` checks 1280, 1440, 1670 and 390 pixel widths
in light and dark.

The page uses one document scroll on flat paper: tall rails flow naturally and the
full-width footer follows the content. Only a rail that fits the viewport becomes
sticky.

```sh
pnpm --filter @langwatch/docs-site test:polish --out-dir "$TMPDIR/docs-test-dist" --screenshots "$TMPDIR/docs-polish"
```

Pass `--before <previous-build>` to capture matching guide and agent-card baseline
screenshots. The suite also exercises grouped command results, keyboard actions,
contextual menus, theme selection and complete prompt copying.

## Release updates

The root `CHANGELOG.md` supplies the latest published version, date and change
for the static announcement. The two newest entries also appear on
`/self-hosting/releases` and in its Markdown export. Source MDX is unchanged.
Dev watches the changelog, and the docs CI workflow includes it in its path
filter. Missing or invalid release data hides the strip. Dismissal is remembered
per version; storage denial still allows dismissal for the current document.
There is no automatic ticker or additional announcement script.

```sh
pnpm --filter @langwatch/docs-site test:news --out-dir "$TMPDIR/docs-test-dist" --screenshots "$TMPDIR/docs-news"
```

Every configured page exports identical Markdown at `.md`, `.claude` and `.agent`; API exports include the resolved endpoint, authentication, parameters, request/response schemas and curl example, while guides retain authored MDX with their title and description. The latter two are content aliases rather than agent configuration. Root `index` exports map to the introduction. Discovery includes `llms.txt`, `robots.txt`, `humans.txt`, `agents.txt` and `sitemap.xml`. Local preview sets Markdown content types for all three extensions; production hosting must do the same.

Alt+Shift+C copies the current page outside editable controls. The sidebar command selector copies the five supported CLI launchers; Cursor and Aider use the gateway guide rather than an invented wrapper command. Page feedback links open a GitHub issue draft containing the page URL.

The coding-agent hero uses checked-in 640/1024/1560px WebP derivatives of the existing session-detail PNG, with responsive preload only on its overview page. Other imagery remains lazy. Run `test:refinement --out-dir <build> --screenshots <scratch-directory>` for the exports, clipboard, tab-panel mapping, responsive image, and footer checks.

## Binary assets

Docs images, video, fonts and downloads are ordinary Git files for now. Git LFS
returns once these docs replace Mintlify. The build already rejects an unresolved
LFS pointer file before emitting output, so that move needs no build change.

## Static search metadata

Every page emits a canonical URL, description when provided, Open Graph/social metadata, a factual WebPage JSON-LD record, breadcrumbs linking to real pages, a Markdown alternate and an llms.txt discovery link during prerender. HTML aliases share one canonical URL; introduction uses the root URL. Client navigation updates the destination metadata together with its content. The custom 404 is marked noindex. Public OpenAPI documents are copied alongside the page exports. Guide exports inline supported snippet imports and include provenance and absolute documentation links; fenced examples remain unchanged.

These are discoverability and sharing features, not ranking guarantees. Validate production status codes, redirects and response headers against the future host; Markdown HTTP canonical/noindex response headers and production search analytics have not been configured here.
