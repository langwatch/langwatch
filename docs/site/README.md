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
the picker changes the paste instructions, and an expandable preview shows exactly
what is copied. The source remains in the MDX.
The compiler watches that source so edits also refresh the home panel in dev.

Potential design-system contributions are the layered documentation shell,
agent setup panel and compact announcement strip. They remain docs-local until
another surface needs the same behaviour. The docs also disable drawer and dialog
animations under reduced motion; that behaviour is a design-system candidate.

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
ambiguity. Omitting it retains the normal `docs/site/dist` output. Preview still
defaults to port 4173, and fails if its chosen port is occupied.

## Publish to S3 and CloudFront

`.github/workflows/docs-site-deploy.yml` builds and tests changes under `docs/**`
on pull requests and main, with a manual dispatch option. Deployment runs only on
main when the repository variable `DOCS_DEPLOY_ENABLED` is `true`. It uses the
`docs-production` GitHub environment; configure its protection rules before
turning deployment on. No cloud resources are created by this workflow.

The following settings must name existing resources:

| Setting                           | Kind                | Purpose                                        |
| --------------------------------- | ------------------- | ---------------------------------------------- |
| `DOCS_DEPLOY_ENABLED`             | Repository variable | Explicit deployment switch, initially unset    |
| `DOCS_AWS_REGION`                 | Repository variable | Region of the S3 bucket                        |
| `DOCS_S3_BUCKET`                  | Repository variable | Dedicated documentation bucket, no path prefix |
| `DOCS_CLOUDFRONT_DISTRIBUTION_ID` | Repository variable | Distribution to invalidate                     |
| `DOCS_CLOUDFRONT_FUNCTION_NAME`   | Repository variable | Existing viewer request function               |
| `DOCS_AWS_ROLE_ARN`               | Repository secret   | AWS role assumed through GitHub OIDC           |

The role trust policy must restrict the repository and `docs-production`
environment. Grant only bucket list/location, object get/put/delete, function
get/describe/update/publish, and distribution create/get invalidation permissions
for those resources. Static AWS access keys are unnecessary.

The distribution must use the dedicated private S3 REST origin with Origin Access
Control, the function associated with its default viewer-request behaviour, and
runtime `cloudfront-js-2.0`. Cache policy minimum TTL must be zero so origin cache
headers are honoured; maximum TTL must allow one year. Configure both S3 403 and
404 errors to serve `/404.html` with status **404**, with a short error-cache TTL.
Do not map missing pages to `index.html` or return a success status for them.
The site currently deploys at the hostname root, not underneath `/docs`.

The build assembles `dist/_deployment/viewer-request.js` from the checked-in
`cloudfront/viewer-request.js` and all redirects in `docs/docs.json` (currently
116). It enforces CloudFront’s 10 KB limit. The function checks redirects before
mapping `/path` and `/path/` to `/path/index.html`; asset paths remain intact.
Incoming query parameters are retained, with destination values taking precedence.
As in local preview, repeated incoming keys retain their first value. The function
configuration is emitted beside the code. Neither deployment metadata nor link
reports are uploaded to the public bucket.

Uploads happen in two stages: hashed `assets/` first with a one-year immutable
cache header, then HTML and other mutable files with `max-age=60,must-revalidate`.
The second sync deletes removed pages. Previous hashed assets are retained so
readers of cached HTML can still load their chunks; any later bucket lifecycle
cleanup must retain them beyond the HTML cache window and rollback period.
The workflow updates and publishes the existing function, invalidates `/*`, and
waits for that invalidation to complete. Deployments are serialised and are not
cancelled mid-sync. S3 updates are not atomic; rerun the complete workflow after a
partial failure. To roll back, dispatch from main after reverting the relevant
source commit. The workflow will build and validate that source again.

The local link check is a release gate and has no exclusions. The previously
reported authored anchor errors have been corrected. Reports remain in the
uploaded CI artefact when validation fails. The existing Mintlify `docs-release.yml` remains untouched;
retiring that workflow and switching DNS are separate cutover decisions.

AWS references: [function runtime](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html),
[function quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html),
[custom error responses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html).

## Shared session prototype

[ADR-180](../../dev/docs/adr/180-docs-session-credentials.md) is a draft requiring
product-owner approval. No app endpoint, credential mint, popup exchange or
production session adapter is implemented. The default build has no session
control. Manual API-key entry continues to work as before.

Set `VITE_DOCS_SESSION_AUTH=mock` at build or dev startup to expose **Use my
LangWatch session** in the API playground. Only `off` (the default) and `mock`
are accepted. This is public build configuration, never a secret. The demo uses
one fixed project and one-minute credentials held only in memory. It simulates
`GET /api/v1/traces/{traceId}` locally, refuses other scopes and never sends the
mock credential to a network endpoint. Connection clears manual-key input;
expiry, disconnect and leaving the page clear session access. Switching back to
a manual key is explicit. Examples and copied code keep environment placeholders.

The docs-local `DocsTokenProvider` interface in `src/auth/token-provider.ts`
separates acquisition and revocation from the playground. The controller validates
provider responses, rejects late connections and enforces expiry and scope. A
future app adapter requires approval and additional origin/source/state checks;
setting a flag cannot enable an unimplemented live provider. The mock does not
sign anyone into or out of their real LangWatch account.

```sh
VITE_DOCS_SESSION_AUTH=mock pnpm --filter @langwatch/docs-site dev
VITE_DOCS_SESSION_AUTH=mock pnpm --filter @langwatch/docs-site build --out-dir "$TMPDIR/docs-session-dist"
pnpm --filter @langwatch/docs-site test:session --out-dir "$TMPDIR/docs-session-dist" --screenshots "$TMPDIR/docs-session-shots"
```

For a haven review in this worktree:

```sh
VITE_DOCS_SESSION_AUTH=mock .bin/haven/haven up --only docs --agent -d
.bin/haven/haven browser open https://docs.feat-docs-site.langwatch.localhost:1355/api-reference/traces/get-trace --lane docs
.bin/haven/haven browser close --lane docs
.bin/haven/haven down
```

Restart dev without the flag to hide the prototype. Production CI never sets it.
The session smoke runner requires a mock-enabled build and checks both themes
at 1440 and 390 pixels, including expiry, disconnect, clipboard redaction and
zero API calls. Unit tests cover the default flag, cancelled acquisition, invalid
credentials and restricted operations. Real popup, CSRF, CORS, server revocation
and self-hosted behaviour remain proposed scenarios, explicitly unimplemented.
