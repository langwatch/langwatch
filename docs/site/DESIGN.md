# Revision 4: performance

Static HTML is the product. The approved design-system components still render
all page content, navigation, examples and form controls on the server. The
prerenderer collects their emitted CSS, deduplicates exact rules in encounter
order and writes one content-hashed stylesheet. The browser never needs Chakra
or Emotion to paint. Highlighting and Mermaid remain build-time work. Public
operation metadata is inert JSON; no credential or executable hydration state is
serialised into a page.

## Browser boundaries

A small bootstrap installs same-origin HTML navigation and a module-script
loader. Lightweight controls load on first interaction or after the page settles:
copy actions, themes, mobile navigation, code/status tabs, agent selection, media
and contents tracking. They enhance the existing semantic HTML. Search and the
API playground mount isolated React roots only on explicit interaction. Their
native elements use extracted design-system variables; static control markup is
not recreated in the browser. The API uses the existing request generator,
validation and session-provider seam. No automatic request is sent on mount.
Navigation disposes the API root, aborts pending work and clears credentials.

React is retained for stateful islands because it is already installed and keeps
the existing hooks/session lifecycle. Preact compatibility would add a dependency
and a second compatibility surface for limited benefit: React is absent from the
initial request. Whole-page hydration, Chakra in a lazy page bundle, runtime
highlighting and a second client-side copy of MDX are rejected. Hydrating small
static buttons with React would charge the renderer cost for no useful state, so
those controls use browser event delegation instead. Module scripts give each
island a separate entry without runtime CSS generation.

## Navigation and deployment

Internal ordinary links prefetch on hover/focus; at most three content links also
prefetch when visible. A bounded in-memory cache lives for 30 seconds. Modified,
external, download, query-string and asset links retain normal browser behaviour.
Navigation parses fetched static HTML, waits for its styles, replaces the page
layout and mobile tree, preserves the header, updates metadata/history, restores
scroll on back/forward, focuses the content and announces the new title. A
changed build identifier or failed fetch falls back to a full document load.
Native links and disclosure elements remain usable without JavaScript.

A small hand-written service worker is worthwhile for repeat/offline reading,
not as a prerequisite for fast navigation. It precaches the bootstrap, extracted
styles, reading fonts and a standalone offline page. React, playground code, images and video
are not precached. Public page HTML and search use stale-while-revalidate for at
most 60 seconds, then network-first with cached offline fallback. Page caches are
bounded to 40 entries. Hashed assets are cache-first. Non-GET, cross-origin,
query-bearing, API, tRPC and authentication-header requests bypass caching;
private/no-store responses are not stored.

The worker version hashes the rendered documents, including hashed CSS/JS
references, together with the worker source and reading fonts. A successful install activates the new cache and removes previous
versions. It neither forces a reload nor claims existing tabs. The next document
navigation adopts the new version. The deployment retains old immutable assets,
so an open document can still load its lazy chunks. CloudFront gives mutable
files, including sw.js and search, a 60-second revalidation policy; worker
registration bypasses the browser HTTP cache. No Workbox dependency is needed.
See [MDN lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Scroll layout

The paper meets the header and extends through the document to its footer. Only
side navigation and the contents rail have viewport-bounded sticky scrolling;
main content and the API panel use document scrolling. The sidebar is 280 pixels
wide with compact method badges. Operation labels occupy at most two lines, with
full text retained for assistive technology and in the title. On navigation the
sidebar starts at the top, scrolling only enough to reveal a deeper active page.

## Verification and budgets

`pnpm --filter @langwatch/docs-site size --out-dir <build> --before <baseline>`
reports raw and gzipped sizes and fails if bootstrap plus idle controls exceed
15,000 gzipped bytes. `test:performance` exercises zero-JavaScript styling,
client navigation, prefetch reuse, worker updates/offline fallback and a lazy API
request. `test:layout` checks 1280/1440/1670/390 widths in both themes. Existing
smoke and mock-session tests continue to cover the interactive surface.
