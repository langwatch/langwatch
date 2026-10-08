# ADR-173: Loading the application's code on a lossy link

**Date:** 2026-10-08

**Status:** Accepted

## Context

The owner, on a link that drops requests, saw a blank page at sign-in and a crashed tab after
one dropped chunk. The production build's first load was 147 files (the entry's static import
graph, split by Rolldown's defaults), and the boot fetched about 260 more lazily before sign-in
painted. One dropped static import fails the whole module graph, and nothing in the page could
run to recover.

Browsers differ on a failed `import()`. Chromium 153 keeps the failure in the module map: the
same address rejects at once without a request, and so does any module that statically imports
a failed one. Firefox 155 and WebKit 26.6 fetch again. whatwg/html#10327 (merged July 2026)
changes the spec; engines have not shipped it. Chromium does keep every file that arrived in
its HTTP cache, even when the graph around it failed, and our assets are `immutable`.

## Decision

1. **Fewer files.** Two `codeSplitting` groups (`apps/ui/vite/entry-core-chunks.ts`), below the
   named Shiki and preload-helper groups: `core` holds the entry's static closure, and
   `host-mounts` holds every `*-host-mount.tsx` (the root renders them all on every page).
   The first load is 4 files; sign-in fetches 64 in all, from 411. No `maxSize`: splitting the
   core cut across import cycles and broke boot.
2. **Retry where the import is made.** A build plugin (`apps/ui/vite/chunk-import-retry.ts`)
   wraps every `import()` in our source in `importChunk`: three retries after 0.5, 1 and 2
   seconds, each importing the address the failure named under a fresh `?retry=n` query, since
   Chromium will not refetch the same address. Retrying by address is only right at a bare
   import: a loader that reshapes the module (`{ default: m.Thing }`) would get the raw module
   back, which crashed the app chrome. Loaders around it use `loadChunk`, which retries by
   calling the loader again and never retries a failure an inner `importChunk` gave up on.
3. **Reload before the first page.** An inline script first in `apps/ui/index.html` reloads the
   page when a tag the server sent fails, when `loadChunk` gives up (`ui:chunk-failed`), or when
   nothing finishes for 30 seconds. Reloads converge on the HTTP cache. It gives up after six
   reloads in a row that fetched no new code (20 at most) and offers "Try again"; the first
   page's commit (`ui:mounted`, from the root layout) stands it down. The script is inline, so
   the policy must keep allowing inline scripts, as it already does for the asset base.
4. **After the first page**, a chunk that still fails shows "Could not load" with a reload
   button; the page reloads by itself only when the server answers 404 (a deploy removed it).
   Vite's `vite:preloadError` is never `preventDefault`ed: that resolves the import with
   `undefined`.

## Consequences

- One `core` file of about 1 MB gzipped changes on every deploy, so a returning visitor fetches
  it whole. Splitting it safely needs `strictExecutionOrder`, which wraps every module.
- The boot still loads about 60 files lazily (root capabilities and the sign-in route). Grouping
  the root capabilities the same way is the next step if the owner still sees retries.
- A nonce-based script policy would block the inline script; it would need the nonce too.
