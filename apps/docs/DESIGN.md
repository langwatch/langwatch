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
styles, the Latin reading font and a standalone offline page. Other font faces cache on demand. React, playground code, images and video
are not precached. Public page HTML and search use stale-while-revalidate for at
most 60 seconds, then network-first with cached offline fallback. Page caches are
bounded to 40 entries. Hashed assets are cache-first. Non-GET, cross-origin,
arbitrary query-bearing, API, tRPC and authentication-header requests bypass caching;
the public index's build-version query supports offline search. The worker is
scoped to the mount and bounds both page and demand-loaded asset caches;
private/no-store responses are not stored.

The worker version hashes the rendered documents, including hashed CSS/JS
references, together with the worker source and reading fonts. A successful install activates the new cache and removes previous
versions. It neither forces a reload nor claims existing tabs. The next document
navigation adopts the new version. Future hosting should retain old immutable assets so an open document can still
load its lazy chunks, and revalidate mutable HTML, worker and search files promptly.
Worker registration bypasses the browser HTTP cache. No Workbox dependency is needed.
See [MDN lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Scroll layout

The page has three document-flow regions: sticky header, a flat paper page and a
full-width footer, matching the brand site: white paper, ink type and hairline
rules, with no floating panel or gradient ground. The navigation rail stays below the
header and scrolls on its own; a tall contents rail flows with the document and
only one that fits the available viewport becomes sticky.
Code, tables, prompts and API responses have no vertical scroll limit. The sidebar is 280 pixels
wide with compact method badges. Operation labels occupy at most two lines, with
full text retained for assistive technology and in the title.

The page tree draws a faint guide line down every open group, at every depth, and
marks the current page on it. Group headers are links (an authored `root`, else the
group's first page) with a separate chevron that opens the group. Groups start open
when they hold the current page, are authored `expanded` (the integration
categories and their providers), hold a single page, or are endpoint groups of
four or fewer; endpoint groups show their endpoint count. Integration pages show
the brand logo their overview card uses, on a light chip so dark marks stay
legible. Client navigation carries the rail's scroll and open groups to the next
page and compensates for the document scrolling to the top, so no link moves
under the pointer. Initial loading keeps the article and top gap in view; the
rail, never the document, scrolls to an active link outside its view. The
mobile drawer and command bar are overlays with bounded scrolling.

## Verification and budgets

`pnpm --filter @langwatch/docs-site size --out-dir <build> --before <baseline>`
reports raw and gzipped sizes and fails above 3,000 bytes for initial reading or
15,000 bytes for bootstrap plus idle controls. It also reports deferred reading,
and interaction costs separately. `test:performance` exercises zero-JavaScript styling,
client navigation, prefetch reuse, worker updates/offline fallback and a lazy API
request. `test:layout` checks 1280/1440/1670/390 widths in both themes. Existing
smoke and mock-session tests continue to cover the interactive surface.

## Shared command surface and contextual controls

Search uses the published CommandBarSurface, Input, Group, Item and Footer from
the design system. The portal-based surface cannot be extracted as a closed
static frame, so its React/Chakra runtime loads only when search is requested.
The contextual Menu surfaces share that deferred runtime. Their explicit design-system
provider uses the five recipes those islands render and the shared semantic foundation;
it does not pull in a second full theme or next-themes. Prerendering keeps the
full system. A new interactive Chakra component needs its recipe added to
`src/app/island-theme.ts` and covered in the island parity checks. No navigation-module
browser code is imported. A docs-local result/action model leaves room for a
future search mode without enabling Langy. Keyboard navigation keeps the caret
in the search field and identifies its active result; Enter opens it, modifier
Enter opens a new tab, modifier L copies its link, and Escape restores focus.

Headings use the brand's Sentient serif; body text is Inter and code JetBrains
Mono, all self-hosted. Brand orange (#f56b1a) decorates; text accents use its
darker brand-700 companion so they meet AA on paper.
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
Sidebars and mobile navigation show the CLI command as one terminal line, with a
setup-guide link, on every page. The command prefix stays readable;
the idle reading script types successive supported agent names. It pauses while
hovered or focused, stops on a deliberate choice, and stays still for reduced
motion. The picker has a visible chevron and copies its complete command. A
manual choice is retained across client navigation. Its caption reads “Trace any
coding agent”.

Linked cards are real cards at rest: a raised surface with a full border, an outline icon or a light logo chip (so dark third-party marks stay visible in both themes), title and description; hover only adds lift and an accent edge. Steps use solid accent number markers joined by an accent line, and authored tabs sit in one framed panel with a raised active tab. Coding-agent setup is a real CLI command line in every sidebar, with direct setup links on its overview. The overview's existing product capture supplies visual context; it remains a screenshot, not an interactive demo. The contents rail curves between nesting levels and animates the active segment; reduced motion disables the animation. Overflowing tab strips show a scrolling hint, reveal keyboard-selected tabs horizontally, and preserve document scroll. The footer and document overscroll share opaque paper.

Design-system ownership remains tokens, primitives, accessible menus/dialogs/tabs, brand assets and command bar. Documentation owns its page grid, navigation tree, ToC, prose/MDX adapters, release strip, agent setup composition, copy controls and exports.
