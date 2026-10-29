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

## Feature layout

`src/` is features, not modules: each folder under `src/features/` owns one subject in up to four
layers, and the lint rule `langwatch/app-feature-layout` holds the shape (opt-in and graph in
`package.json`, tables in `packages/oxlint-rules/grammar/app-feature-layout.mjs`, decision in ADR-137).

- `model/` is pure and takes only `model/`. `ui/` (build-time React) takes `model/` and `ui/`.
  `compile/` (Node, Vite plugins, MDX) and `browser/` (islands) take `model/` and their own layer,
  never `ui/`: rendering a component is the composition's job, and an island must not bundle React.
- Another feature is imported only through its entry, `features/<name>/<layer>.ts`, which holds
  named re-exports of that layer and nothing else. The browser entry is separate from the build-time
  ones, so an island pulls in no build code; it never re-exports an island that runs on load.
- `package.json` `langwatch.features` names each feature and the features it imports. The graph is
  acyclic: code, releases, content, api-reference, navigation, discovery, search, shell.
- `lib/` and the top-level files (`config.ts`, `paths.ts`) are leaves every place imports. `app/`,
  `site/`, `browser/` and `testing/` compose features through their entries and nothing imports them.

## Browser boundaries

A small bootstrap installs same-origin HTML navigation and a module-script
loader. Lightweight controls load on first interaction or after the page settles:
copy actions, themes, mobile navigation, code/status tabs, agent selection, media
and contents tracking. They enhance the existing semantic HTML. Search and the
API playground mount isolated React roots only on explicit interaction. Their
API elements use extracted design-system variables; static control markup is
not recreated in the browser. The API uses the existing request generator,
and validation. No automatic request is sent on mount.
Navigation disposes the API root, aborts pending work and clears credentials.

Search and the page menu run on no component runtime at all (see below). The
playground runs on `preact/compat` in the browser build, about a tenth of react-dom's
size, so a first click on it downloads little. No island hydrates server markup: each mounts into an empty node, so
prerendering keeps real React and the HTML is unchanged. Whole-page hydration, Chakra in a lazy page bundle, runtime
highlighting and a second client-side copy of MDX are rejected. Hydrating small
static buttons with React would charge the renderer cost for no useful state, so
those controls use browser event delegation instead. Module scripts give each
island a separate entry. Reading needs no runtime CSS generation, and neither
does the command bar or the page menu described below.

## Navigation and static hosting

Internal ordinary links prefetch on hover/focus; at most three content links also
prefetch when visible. A bounded in-memory cache lives for 30 seconds. Modified,
external, download, query-string and asset links retain normal browser behaviour.
Navigation parses fetched static HTML, waits for its styles, replaces the page
layout and mobile tree, preserves the header, updates metadata/history, restores
scroll on back/forward, focuses the content and announces the new title. A
changed build identifier or failed fetch falls back to a full document load.
Native links and disclosure elements remain usable without JavaScript.

The docs install no service worker and have no offline mode: they are served on a subdomain
that must not hold one. Repeat reading relies on HTTP caching of hashed assets.

Hosting should retain old immutable assets so an open document can still load its lazy
chunks, and revalidate mutable HTML and search files promptly.

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
15,000 bytes for bootstrap plus idle controls. The build drops Vite's modulepreload polyfill
(every target browser reads modulepreload) and inlines imported constants, so a `/docs` build's
bootstrap imports no shared config chunk. It also reports deferred reading,
and interaction costs separately. `test:performance` exercises zero-JavaScript styling,
client navigation, prefetch reuse and a lazy API
request. `test:layout` checks 1280/1440/1670/390 widths in both themes, and touch screens at
360/390/768: no sideways scroll, text at least 11px (article text 16px), and a 44px target on
every control outside running text. On a coarse pointer an invisible layer centred on each small
control grows its hit area to 44px without changing how it looks, and the announcement strips
grow to 44px tall. Existing smoke tests continue to cover the interactive surface.

`test:audit` reads a `/docs` build (`build --base-path /docs`; it refuses a build made for another
mount) and runs Lighthouse with the default mobile emulation and throttling and the desktop
preset on eight representative pages, held to `src/site/audit/budgets.json`: accessibility, best
practices and SEO at 100, performance floors with room for CI runners. It also reports
Lighthouse's experimental agentic browsing checklist without gating on it, as the marketing site
does. The preview serves like the production host should: gzip, hashed assets, fonts and media
immutable for a year, media keeping its authored name for a day, documents revalidated; a page request preferring
`text/markdown` gets the page's Markdown twin, and every page names its twin in a `Link` header.

Beside that gate, `.github/workflows/docs-site-lighthouse-all.yml` runs the same audit on every
published page (`audit:site --all-pages --shard i/n --report-only`, one run per page and device,
ten shards per device), and `src/site/audit/all-pages.ts` merges the shards with the static
search checks into one sticky PR comment, the run summary and an artifact. It is informational
and never gates; deleting its `pull_request` trigger leaves the daily run.

## Shared command surface and contextual controls

Search uses the published CommandBarInput, Group, Item and Footer from the design
system, rendered at build time into inert `<template>` elements on every page, so
their styles come from the page stylesheet like any other prerendered markup. The
search island is plain TypeScript: it moves the bar into a native modal `<dialog>`
and fills rows by cloning the row templates, selecting one by toggling the
`data-selected` attribute CommandBarItem styles. It downloads about 5 KB.
The page menu works the same way: the design system's Menu is drawn open, not
portalled, into a template beside its trigger, and the context menus island shows
that markup as a native popover, places it below the trigger's end edge, and runs
the arrow keys, Enter, Escape and the copy actions by hand. A new interactive
control follows the same pattern: draw it at build time, and keep its island to
behaviour. No navigation-module
browser code is imported. A docs-local result/action model leaves room for a
future search mode without enabling Langy. Keyboard navigation keeps the caret
in the search field and identifies its active result; Enter opens it, modifier
Enter opens a new tab, modifier L copies its link, and Escape restores focus.
An inline listener in the page head catches Meta or Ctrl+K before any script has loaded, so the
first shortcut always opens search once its island arrives. The island and the chunks it imports
are preloaded when a reader heads for search (pointer or focus on the search button, or Meta or
Ctrl held), since modulepreload alone fetches only the entry; most readers never open search, so
no page pays for it up front.

Headings use the brand's Sentient serif; body text is Inter and code JetBrains
Mono, all self-hosted. Brand orange (#f56b1a) decorates; text accents use its
darker brand-700 companion so they meet AA on paper.

Design-system candidates: Kbd size variants; CommandBarInput native input/ARIA
props; semantic link/button command rows with a badge/secondary-line slot. The
existing navigation catalogue, recent-item storage and Langy handoff remain owned
by navigation and are not duplicated in docs.

The page menu supports Markdown copy/view, Claude, ChatGPT and copying a link.
It also connects editors to the LangWatch MCP server, which searches these docs:
Cursor and VS Code get their install deep links, and any other MCP client can copy
the server URL. A static site hosts no server, so every MCP action points at
app.langwatch.ai/mcp.

## Release announcement

The top strip shows one published update from the repository CHANGELOG.md, with
version, date and its first feature or fix. One static line earns less attention
than an automatically rotating ticker: it truncates on desktop and retains the
version/date on phones, with no motion in either preference mode. Existing tiny
controls remember dismissal by version, so another release is visible again.
There is no fetch or rendering runtime for the strip. Missing or invalid notes
omit it. The five newest releases are injected into the changelog page and its
Markdown output at build time; the changelog links on to the self-hosting
releases and upgrade pages. The home page's `<WhatsNew />` tag becomes a short
list of the three newest, each linking to its changelog entry. The docs.json
announcement and the release line both sit on paper with muted text; each leads
with a mono tag behind a hairline (an orange status dot and "new", or "What's
new" and the version), and both dismiss buttons are the same 24-pixel square.
Sidebars and mobile navigation show the CLI command as one terminal line, with a
setup-guide link, on every page. The command prefix stays readable;
the idle reading script types successive supported agent names. It pauses while
hovered or focused, stops on a deliberate choice, and stays still for reduced
motion. The picker has a visible chevron and copies its complete command. Readers
can click a faded neighbour, drag the wheel, flick it to spin with friction or turn it
with the mouse wheel; a fast spin flashes casino names past that never reach the landing
agent or assistive technology, and reduced motion steps one agent per drag. A
manual choice is retained across client navigation. Its caption reads “Trace any
coding agent”.

Linked cards are compact and scannable: a full border, the glyph in a 32-pixel accent-tinted tile or a logo on a light chip (so dark third-party marks stay visible in both themes), a strong title and one or two short lines; rows size to their content, so no card holds dead space. Hover lifts the card, warms its edge and nudges the arrow. Logo-only grids keep the bare logo. Labels above titles and footer groups use one engineering voice: a quiet mono path (`Platform / Get Started`) in muted ink with an accent slash, never spaced uppercase. Steps use solid accent number markers joined by an accent line, and authored tabs sit in one framed panel with a raised active tab. Coding-agent setup is a real CLI command line in every sidebar, with direct setup links on its overview. The overview's existing product capture supplies visual context; it remains a screenshot, not an interactive demo. The contents rail curves between nesting levels and animates the active segment; reduced motion disables the animation. Overflowing tab strips show a scrolling hint, reveal keyboard-selected tabs horizontally, and preserve document scroll. Tabs offering the same language share one remembered choice (TypeScript, JavaScript and Node are one language; Python and py another; curl, Bash and Shell a third): picking one selects it in every group offering it, scrolls so the picked tab stays put, and an inline script after the page markup applies it before first paint. A page's header and first five blocks rise in with a stagger of at most 400ms, on first load and on a page change alike, using opacity and transform only; reduced motion turns it off. The footer and document overscroll share opaque paper.

Design-system ownership remains tokens, primitives, accessible menus/dialogs/tabs, brand assets and command bar. Documentation owns its page grid, navigation tree, ToC, prose/MDX adapters, release strip, agent setup composition, copy controls and exports.
