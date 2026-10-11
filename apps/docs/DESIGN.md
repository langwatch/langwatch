# Documentation app design

Static HTML is the product. The approved design-system components still render
all page content, navigation, examples and form controls on the server. The
prerenderer collects their emitted CSS, deduplicates exact rules in encounter
order and writes one content-hashed stylesheet. The browser never needs Chakra
or Emotion to paint. Highlighting and Mermaid remain build-time work. Public
operation metadata is inert JSON; no credential or executable hydration state is
serialised into a page.

## Source and build boundaries

The app owns feature folders without the server module installation pipeline.
Build-only compilers are separated from portable models, React presentation and
browser behavior. One Vite configuration resolves authored MDX, shared runtimes
and explicit lazy entries. Strict TypeScript covers this path; build tools run
on Node 24. The workspace catalog owns dependency versions. Oxc React Compiler
optimizes docs React components without compiling shared design-system sources
again. The unused whole-page hydration entry is removed.

Build output is a static directory. Each prerender bundle has its own temporary
directory and cleans up only that directory on success or failure. Exact
redirects have static fallback pages; pattern rules and HTTP behavior belong to
a future host. CI validates and uploads the artifact, without cloud deployment
or host-specific code generation.

## Browser boundaries

A small bootstrap installs same-origin HTML navigation and a module-script
loader. Lightweight controls load on first interaction or after the page settles:
copy actions, themes, mobile navigation, code/status tabs, agent selection, media
and contents tracking. They enhance the existing semantic HTML. Search and the
API playground mount isolated React roots only on explicit interaction. Their
API elements use extracted design-system variables; static control markup is
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
island a separate entry. Reading needs no runtime CSS generation; the shared
command and menu surfaces described below load their runtime on interaction.

## Navigation and static hosting

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
navigation adopts the new version. Future hosting should retain old immutable assets so an open document can still
load its lazy chunks, and revalidate mutable HTML, worker and search files promptly.
Worker registration bypasses the browser HTTP cache. No Workbox dependency is needed.
See [MDN lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Scroll layout

The page has three document-flow regions: sticky header, a floating paper panel,
and a full-width footer outside that panel. A 32-pixel desktop gap exposes the
ambient ground above rounded paper corners. Tall navigation and contents rails
flow with the document; only rails that fit the available viewport become sticky.
Code, tables, prompts and API responses have no vertical scroll limit. The sidebar is 280 pixels
wide with compact method badges. Operation labels occupy at most two lines, with
full text retained for assistive technology and in the title. Only the current navigation branch starts expanded. Initial loading keeps the
article and top gap in view; deeper active links remain in their expanded branch
without moving the document away from its heading. The mobile drawer and command
bar are overlays with bounded scrolling.

## Verification and budgets

`pnpm --filter @langwatch/docs-site size --out-dir <build> --before <baseline>`
reports raw and gzipped sizes and fails if bootstrap plus idle controls exceed
15,000 gzipped bytes. `test:performance` exercises zero-JavaScript styling,
client navigation, prefetch reuse, worker updates/offline fallback and a lazy API
request. `test:layout` checks 1280/1440/1670/390 widths in both themes. Existing
smoke and mock-session tests continue to cover the interactive surface.

## Shared command surface and contextual controls

Search uses the published CommandBarSurface, Input, Group, Item and Footer from
the design system. The portal-based surface cannot be extracted as a closed
static frame, so its React/Chakra runtime loads only when search is requested.
The contextual Menu surfaces share that deferred runtime. No navigation-module
browser code is imported. A docs-local result/action model leaves room for a
future search mode without enabling Langy. Keyboard navigation keeps the caret
in the search field and identifies its active result; Enter opens it, modifier
Enter opens a new tab, modifier L copies its link, and Escape restores focus.

The ambient shader uses the design system's framework-free export, in a separate
idle chunk. Reduced motion loads no shader; visibility and theme changes dispose
and remount its graphics resources. The footer stays opaque. Paper uses a 96% opaque fill and a slight backdrop blur
only without reduced motion; reduced transparency and forced colours retain
opaque paper.
The static floor uses the marketing mesh palette and is present without scripts.

Design-system candidates: Kbd size variants; CommandBarInput native input/ARIA
props; semantic link/button command rows with a badge/secondary-line slot. The
existing navigation catalogue, recent-item storage and Langy handoff remain owned
by navigation and are not duplicated in docs.

The page menu supports Markdown copy/view, Claude, ChatGPT and copying a link.
Cursor, VS Code and MCP actions are omitted: docs.json lists their names but does
not provide an install target or a supported page-handoff URL. Inventing those
would produce a misleading action.

## Release announcement

The top strip shows one published update from the repository CHANGELOG.md, with
version, date and its first feature or fix. One static line earns less attention
than an automatically rotating ticker: it truncates on desktop and retains the
version/date on phones, with no motion in either preference mode. Existing tiny
controls remember dismissal by version, so another release is visible again.
There is no fetch or rendering runtime for the strip. Missing or invalid notes
omit it. The two newest releases are injected into the existing releases page
and its Markdown output at build time, above the authored support policy.
Sidebars and mobile navigation expose the supported CLI command selector and
setup-guide link on every page.

The reading surface uses compact linked rows instead of repeated raised cards. Coding-agent setup is a real CLI command selector in every sidebar, with direct setup links on its overview. The overview's existing product capture supplies visual context; it remains a screenshot, not an interactive demo. The wider contents rail highlights only the active heading. Overflowing tab strips show a scrolling hint, reveal keyboard-selected tabs horizontally, and preserve document scroll. The footer and document overscroll share opaque paper.

Design-system ownership remains tokens, primitives, accessible menus/dialogs/tabs, brand assets, command bar and ambient rendering. Documentation owns its page grid, navigation tree, ToC, prose/MDX adapters, release strip, agent setup composition, copy controls and exports.
