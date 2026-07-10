# ADR-038: Runtime-configurable CDN base for content-hashed assets

**Date:** 2026-07-08

**Status:** Accepted

## Context

The web app is a Vite SPA whose JS/CSS chunks carry content-hash filenames
(`dialog.anatomy-CGguCKQj.js`). In production these are served directly from the
app pods by the Node server (`src/server/static-handler.ts`); there is no CDN in
front. Prod runs three replicas on the default `RollingUpdate` strategy.

During a rolling deploy two builds serve simultaneously behind one Service. A
browser fetches the HTML shell from build A, then a lazy `import()` of a build-A
chunk is load-balanced to a build-B pod that does not have that hash — a hard
`404 (Not Found)`. Reported symptom:

```
GET https://app.langwatch.ai/assets/dialog.anatomy-CGguCKQj.js net::ERR_ABORTED 404
```

Two mitigations already exist and remain: the `vite:preloadError` reload guard
(`src/utils/chunkReload.ts`) and the deliberate `404` for missing `/assets/*`
(spa-fallback.feature). Neither closes the *mid-deploy* window — a reload can
re-split across builds, and the 10s cooldown then strands the tab for the rest of
a multi-minute roll.

No `RollingUpdate` tuning removes the overlap (a Deployment is inherently
rolling); `Recreate` removes it only by adding downtime; blue-green only shrinks
the window. The overlap is not the root cause — coupling *asset availability* to
*which pod/build serves the request* is. The durable fix is to make every build's
assets available independent of which pod serves the shell.

The hard constraint: the published `langwatch` Docker image is **shared by
self-hosters and LangWatch SaaS**. Vite's `base` is a compile-time constant, so a
CDN URL cannot be baked into the image without breaking every self-host install.

## Decision

We will host content-hashed assets on a **commit-prefixed, immutable CDN**
(CloudFront over S3) and choose the base **at container start**, not build time.

**Asset URL indirection (build).** `vite.config.ts` uses
`experimental.renderBuiltUrl` so every JS-referenced asset URL is emitted as
`window.__lwAssetUrl(<path relative to the build root>)`, CSS-referenced assets
become relative to the CSS file, and HTML entry references stay base-absolute
(`/assets/…`). `public/` assets stay same-origin.

**Runtime injection (serve).** The server injects an inline classic
`<script>` into the served HTML shell that defines `window.__lwAssetBase` and
`window.__lwAssetUrl` from `LANGWATCH_ASSET_BASE`, and rewrites the entry
`<script>` / `modulepreload` / stylesheet `/assets/…` hrefs to that base. A
classic inline script runs before deferred module scripts, so the resolver is
defined before the entry chunk's dynamic imports evaluate.

- **Unset / `/` (self-host default):** `__lwAssetUrl("assets/x.js")` → `/assets/x.js`,
  served by the pod exactly as before. The HTML rewrite is a no-op. Behaviour is
  unchanged for self-host.
- **`https://cdn.langwatch.ai/<commit-sha>/` (SaaS):** assets resolve to the
  commit-prefixed CDN namespace.

**Immutability model.** Each deploy `aws s3 sync`s `dist/client/assets/` into
`s3://<bucket>/<commit-sha>/assets/` and **never** `--delete`s. Double
immutability — the content hash freezes each file's bytes; the commit prefix
freezes each build's namespace. Old tabs keep resolving because their build's
prefix still exists. Cleanup is an S3 lifecycle rule expiring prefixes after a
window safely longer than any tab's lifetime. `langwatch/scripts/upload-assets-to-cdn.sh`
performs the sync; the SaaS deploy pipeline invokes it with the build's SHA.

**CSP.** When `LANGWATCH_ASSET_BASE` names an external origin, that origin is
added to `script-src`, `style-src`, `font-src`, `img-src`, `connect-src`, and
`worker-src`. Same-origin serving adds nothing.

**Ownership boundary.** This repo owns the app-side contract (Vite, server, CSP,
the `app.assetBase` Helm value → `LANGWATCH_ASSET_BASE`, the upload script,
this ADR, and `specs/server/cdn-asset-base.feature`). The CloudFront
distribution, the S3 bucket + lifecycle rule, DNS, and wiring the upload +
`<sha>` into the SaaS deploy pipeline live in the infra repo and are a handoff.

## Rationale / Trade-offs

Baking the base at build time (a `VITE_ASSET_BASE` arg) is simpler but forks the
image: the public image would point self-hosters at `cdn.langwatch.ai`. Runtime
injection keeps one image for both audiences at the cost of a small server-side
HTML transform and one inline script. Because JS chunks are served *by the CDN*,
serve-time string replacement in the JS is impossible — the base must resolve in
the browser at execution time, which is exactly what `renderBuiltUrl`'s `runtime`
form provides.

We keep the existing `chunkReload` guard and the missing-asset `404` as
belt-and-suspenders: with the CDN they should effectively never fire, but they
still cover a self-host install, a prefix expired earlier than a tab's lifetime,
or an asset genuinely absent from the bucket.

The rollout strategy is left untouched — the fix removes the *need* to serialize
the roll, so no downtime (`Recreate`) and no new cluster dependency (Argo
Rollouts blue-green) are introduced.

## Consequences

- Mid-deploy asset `404`s disappear on SaaS without changing the rollout, because
  both builds' assets are always present in the CDN, keyed by commit.
- Self-host is unaffected: unset env → same-origin, pod-served assets, no CDN.
- The server now transforms the HTML shell (read + inject) instead of streaming
  it; the shell is tiny and already `no-cache`, so the cost is negligible. Asset
  streaming for non-HTML files is unchanged.
- CSP is now env-derived for the asset origin; misconfiguration surfaces as a
  blocked-resource console error rather than a silent 404.
- New operational duty (infra repo): the S3 lifecycle retention window is both
  the max tab lifetime (a tab older than it 404s, then `chunkReload` recovers
  with a reload) AND the **rollback horizon** — rolling the app back to a tag
  whose prefix expired, or a pre-CDN tag never uploaded, 404s every chunk with no
  recovery for the entry script. Retention defaults to 365d; to roll back
  further, disable the CDN in the same apply so assets fall back to same-origin.
- CloudFront must send permissive CORS (`Access-Control-Allow-Origin`) for the
  asset prefix: `crossorigin` module scripts and fonts are fetched cross-origin
  from the CDN and fail without it. The CSP already admits the CDN origin to
  `connect-src`/`worker-src`/`font-src`; CORS is the server-side half and lives
  in the infra repo.
- **Self-sufficient artifact / Web Workers.** The `renderBuiltUrl` runtime
  expression is self-defaulting — `(globalThis.__lwAssetUrl || (p => "/"+p))(…)`
  — so the built bundle works even when the resolver was never injected: `vite
  preview`, the CI boot-smoke, and any raw-`dist/` static server all fall back to
  same-origin. Reading via `globalThis` (defined in Web Worker scopes too, where
  `window` is not) means a worker chunk degrades to same-origin rather than
  throwing. The only consequence: a future CDN-hosted worker asset would be
  served same-origin (from the pod) instead of the CDN until the server-side
  resolver is made worker-aware — correct, just not edge-cached.

## References

- Related ADRs: ADR-032 (datasets S3 JSONL — same S3 client/CSP `connect-src` derivation)
- Spec: `specs/server/cdn-asset-base.feature`, `specs/server/spa-fallback.feature`
- Code: `src/server/asset-base.ts`, `src/server/static-handler.ts`,
  `src/start.ts`, `vite.config.ts`, `langwatch/scripts/upload-assets-to-cdn.sh`
- Vite: `experimental.renderBuiltUrl` (runtime public base path)
