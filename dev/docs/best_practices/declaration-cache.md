# Declaration build cache

`pnpm typecheck:declarations` refreshes declarations before application checks.
It discovers the adopted projects from `dev/tsconfig.declarations.json`, builds
dependencies first, and reuses successful build artifacts across worktrees.

Each application has a standard `tsconfig.declarations.json` solution containing
its package project references. Its typecheck script passes that config with
`--project apps/<app>/tsconfig.declarations.json`; TypeScript references express
the dependency graph, including the complete cyclic web group when needed.
There is no separate dependency scanner. Add a reference when adopting a new
application dependency. The command without `--project` prepares the full
workspace solution. Both commands reuse the same per-project cache entries.

A non-emitting package config may also be selected: preparation builds its
referenced declaration projects and leaves its own source/tests to the following
`tsc --noEmit` command. This uses the package's normal TypeScript references
without another dependency-selection script.

Each worktree keeps ordinary copies of `.d.ts` and declaration maps in its own
package `dist` folders. Shared cache entries are immutable and published by
atomic rename. Standalone packages keep build-info beside their local output;
the cyclic web group keeps one build-info file and its complete staging tree
under `dev/.cache`, then distributes that tree into each member's local `dist`
after a successful build or restore. Build-info files are never shared.
Restoring different outputs removes the old local build-info file so it cannot
describe the wrong output. Runtime and editor resolution still use source
exports.

JSON under a producer's `rootDir` is copied to matching output paths after a
successful compile because declaration-only emission omits JSON that a public
declaration can still re-export. Those files and their ownership manifest also
enter the cache. Cleanup removes only declarations and recorded JSON outputs;
unrelated runtime files in `dist` remain intact.

The cache key includes:

- Contents of the package and its recursive workspace dependencies, including
  uncommitted source, generated source, manifests, and configuration changes.
- Inherited TypeScript configuration, root configuration, lockfile, pnpm
  settings, conventional `patches` folders, and cache implementation.
- Installed dependency identities and manifests, compiler contents, platform,
  architecture, and compiler flags.

Dependency installation must be reproducible: use pnpm and record dependency
changes or patches in the lockfile. The default does not hash every installed
third-party implementation file. To investigate manual changes inside
`node_modules`, use `LANGWATCH_DECLARATION_CACHE_STRICT=1 pnpm typecheck:declarations`;
this also hashes the installed dependency contents and uses separate keys.
Do not modify the dependency installation while a build is running.

Hashing is conservative: a test or documentation edit inside a dependency can
invalidate its cache. Unrelated packages do not invalidate each other unless
they share a dependency or a global input changes. Input hashing is memoized
within a run, and workspace inputs are checked again after compilation. A
source change during compilation stops the check and requires another run.
Workspace traversal follows production dependencies and explicit TypeScript
project references. Test-only development dependencies contribute installed
manifest fingerprints; their source is not part of the declaration build.

Only successful builds enter the cache. Entry manifests and artifact checksums
are validated before restoration; incomplete or corrupt entries cause a real
build. A failed package or group stops dependent builds and preserves the
compiler's exit status. Misses compile standalone projects with `tsc -p`; the
cyclic web group compiles its composite group once, and only then distributes
its staging artifacts.
Compiler commands run normally. Optional Haven agent hooks can schedule heavy
checks across worktrees; the declaration build has no repository queue wrapper.

The default cache lives in the OS user cache directory under
`langwatch/declarations/<repository-id>`. Worktrees from the same Git repository
share that ID. Set `LANGWATCH_DECLARATION_CACHE_DIR` to choose another directory.
Deleting the shared cache only loses reuse; the next check rebuilds declarations.
`pnpm typecheck:declarations --clean` removes local compiler outputs, and
`--force` rebuilds every adopted project. Cache entries currently have no
automatic size limit or eviction.

The application and package typecheck jobs persist these entries through the
`declaration-cache` GitHub action. Each successful job saves a separate archive
for its platform, lockfile, job, and commit. Restore prefixes reuse previous
runs, including main-branch caches under GitHub's branch access rules. Each
inner entry still validates its own complete input key and checksums, so a
broad archive fallback cannot make stale declarations valid. Failed jobs do
not save a new archive. Package checks run sequentially to avoid concurrent
declaration refreshes writing to the same runner's `dist`.

See [GitHub's cache matching and branch access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).
