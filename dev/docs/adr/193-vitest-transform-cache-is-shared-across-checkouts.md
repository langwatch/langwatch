# ADR-193: Vitest's transform cache is shared across checkouts

**Date:** 2026-10-22

**Status:** Proposed

**Behavioural contract:** [the shared transform cache](../../../specs/ci/shared-transform-cache.feature)

**Related:** [testing speed](../best_practices/testing-speed.md)

## Context

Every package runs Vitest with `fsModuleCache` on (testing-speed.md), which
keeps each transformed module on disk so the next run skips the transform. The
cache lived in each checkout's `node_modules/.vitest-cache`, and Vitest built
its key from the module's absolute path and the project's absolute root. A new
git worktree therefore started with nothing, even when another worktree of the
same commit had transformed every file a minute before.

Work here happens in many worktrees at once, so the first run in a new one is
the common case, not the rare one. Measured on this machine, the first run of
the identity module's suite took 28 to 34 CPU-seconds against 25 to 26 for a
second run, and the API app's 88 to 95 against 56 to 59. One worktree's cache
was 19,503 files and 462 MB.

The transformed code cannot just be copied between worktrees: it names other
modules by absolute path (`__vite_ssr_import__("/@fs/<checkout>/...")`), and
the cache metadata Vitest keeps beside it (the module's id, file and imports)
does too. The inline source map's `file` does as well, though its `sources` are
already relative to the module.

## Decision

**One cache per user, keyed by what the transform depends on.** LangWatch's
existing Vitest patch (`patches/vitest@5.0.1.patch`) changes `fsModuleCache`:

- The cache lives in `~/.cache/vitest/fs-module-cache` (`$XDG_CACHE_HOME` when
  set; `VITEST_FS_MODULE_CACHE_DIR` overrides it; a config's
  `fsModuleCachePath` still wins). Every checkout of every clone uses it.
- The key is the module's path relative to the workspace root, its source, the
  nearest `tsconfig.json` above it with the files it extends, and the
  environment's config (project root relative to the workspace root, resolve
  options, plugin names, config file contents, `define`, Vite's `env`, the Vitest
  and Vite versions).
- Under the cache root, each lockfile gets its own directory, named by Vitest's
  existing lockfile hash, which covers dependency versions and the pnpm patches.
  A lockfile change starts a new directory instead of clearing the one another
  worktree still uses. A directory no run has used for seven days is removed.

**The checkout's path is a token on disk.** On write, the workspace root in the
code and metadata becomes `@@vitest-fs-module-cache-root@@`, and the inline
source map's `file` becomes the bare file name, and the metadata is marked
`portable`. A module outside the workspace root has no directory every checkout
shares, so its inline source map is dropped when a source leads into the
checkout. On read, the main process and the worker (which reads the cached file
itself) put the reading checkout's root back, only into a file marked portable;
the main process passes the mark to the worker with each module it serves. A
module whose source names the checkout's root keeps that root in its key, and a
module whose source contains the token is not cached. Only the shared cache's
files carry the token: the copies of transformed modules the forks pool keeps
(when `fsModuleCache` is off, or for a module the cache skips) are written as
before and not marked, so a token in such a module's source reaches it unchanged.

**A cached import that is missing here is transformed again.** Worktrees at
different commits meet in one cache. An importer whose source did not change
can still resolve an import to a file this checkout does not have (`./b` was
`b.ts` there and is `b/index.ts` here). Before a cached module is used, the
files its imports resolved to are checked; if one is missing, the module is
transformed again.

**Writes stay atomic.** Vitest already writes each entry to a temporary file
and renames it into place, so concurrent writers from several worktrees leave
either entry whole. A cache file that disappears between the check and the read
counts as a miss.

## Rationale / Trade-offs

A config option cannot do this. `fsModuleCachePath` moves the cache but the key
still holds absolute paths, and `defineCacheKeyGenerator` can add to the key but
not take the path out, nor rewrite what is stored. The patch already exists for
Vitest's machine slot, so extending it adds no new mechanism.

The default location is set in the patch rather than in
`@langwatch/vitest-config`, because about a third of the repository's Vitest
configs do not use that helper, and all of them should share.

Rewriting on read rather than storing a copy per worktree keeps one copy on
disk. The cost is a string replacement per module read; the second-worktree
runs below are as fast as a warm run in the same worktree.

The upstream home for this is Vitest itself: a relative key and a root token
are general, and other monorepos with worktrees hit the same cold start. This
patch is the shape an upstream change could take, and moving it there would let
the patch shrink back to the machine slot. Until then it lives here, and a
Vitest upgrade has to carry it forward (the integration test below fails if it
is dropped).

## Upstream proposal

`dev/docs/ARCHITECTURE.md` (Patched dependencies) asks for the upstream change
to be proposed with the patch. It is not filed yet: the issue below is the
draft a maintainer of this repository files on `vitest-dev/vitest`, and its URL
is recorded here once it is. The machine slot in `vitest.mjs` is specific to this repository and is
not proposed.

> **Title:** fsModuleCache: share the cache between checkouts of one repository
>
> `experimental.fsModuleCache` keys each entry on the module's absolute path
> and the project's absolute root, and stores code and metadata that name that
> root. Two git worktrees of the same commit therefore never share an entry,
> and every new worktree starts cold even when its files are byte-identical to
> one that has just run.
>
> Proposal, behind the existing option:
>
> 1. Key on the module's path relative to the workspace root (the directory
>    `searchForWorkspaceRoot` finds), and hash the config with the root
>    replaced, so identical checkouts produce identical keys.
> 2. Store code, inline source map and metadata with the root written as a
>    token, and put the reading checkout's root back on read, in the main
>    process and in the worker that reads the file itself. A module whose
>    source names the absolute root keeps the root in its key; a module whose
>    source contains the token is not cached.
> 3. Before using an entry, check that the files its imports resolved to exist
>    in this checkout, since checkouts at different commits meet in one cache.
> 4. Default the cache to a per-user directory (`$XDG_CACHE_HOME/vitest`, else
>    `~/.cache/vitest`), one subdirectory per lockfile hash, and remove a
>    subdirectory no run has used for a week instead of clearing the cache when
>    the lockfile changes.
>
> In a monorepo of about 150 packages, a new worktree's first run of a
> 77-test suite fell from 88 to 95 CPU-seconds to 52 to 62, the same as a warm
> run. A working patch against 5.0.1, with an integration test that runs two
> checkouts against one cache, is at
> `https://github.com/langwatch/langwatch/blob/main/patches/vitest@5.0.1.patch`.
> We are glad to turn it into a pull request if the direction is welcome.

## Consequences

The first run in a new worktree is a warm run whenever any worktree has
transformed the same files under the same lockfile. Measured with interleaved
runs at load average 24 to 57, CPU-seconds from `/usr/bin/time -l`:

| suite                        | first run before | first run after | warm run before |
| ---------------------------- | ---------------- | --------------- | --------------- |
| identity module (1376 tests) | 27.8 to 34.0     | 24.3 to 26.1    | 24.9 to 26.5    |
| API app (77 tests)           | 87.6 to 94.7     | 51.8 to 61.5    | 55.6 to 59.2    |

Each worktree's `node_modules/.vitest-cache` is removed on its first run with
the patch, which frees up to about 460 MB per worktree.

Two limits carry over from upstream and matter more with sharing. A transform
that depends on a file other than the module, its tsconfig chain and its config
(a workspace package's `exports` that sends an import to a different file that
also exists here) is not in the key. And a lockfile directory grows until the
lockfile changes or it goes unused for a week. `vitest --clearCache`
clears the shared cache for every worktree.

`packages/vitest-config/src/__tests__/shared-fs-module-cache.integration.test.ts`
runs two checkouts against one cache and checks the second reads without
writing, that its stack traces and `import.meta` name its own files, and that a
moved import is transformed again.
