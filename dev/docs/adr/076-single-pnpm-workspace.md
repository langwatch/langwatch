# ADR-076: One pnpm workspace for every JavaScript project

**Date:** 2026-07-28

**Status:** Accepted

## Context

The repo accumulated six independent pnpm install roots, each with its own
lockfile:

| Root                 | Members                                                                    | Lockfile |
| -------------------- | -------------------------------------------------------------------------- | -------- |
| `/`                  | `packages/*` (server-cli, handled-error, langy)                             | 1,949 l  |
| `/langwatch`         | `.`, `packages/*`, `../mcp-server`, `../packages/handled-error`, `../packages/langy` | 21,796 l |
| `/typescript-sdk`    | —                                                                           | 5,091 l  |
| `/mcp-server`        | —                                                                           | 5,965 l  |
| `/skills`            | —                                                                           | 4,862 l  |
| `/agentic-e2e-tests` | —                                                                           | 52 l     |

Two of those overlapped. `mcp-server` was both its own root and a member of the
application's workspace, so CI installed it twice on every application build
(`langwatch-app-ci.yml`, `e2e-ci.yml`). `packages/handled-error` and
`packages/langy` were members of two workspaces at once.

Two more — `skills` and `agentic-e2e-tests` — were not members of any workspace
but sat inside a directory tree whose root declared one, so every install of
them needed `--ignore-workspace` to escape a workspace they were never in.

Three separate consequences followed.

**Onboarding was a trap.** A fresh clone needed `pnpm install` at the root *and*
again inside `langwatch/`. Skipping the second produced
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "prisma" not found`, which reads
like a broken toolchain rather than a missing install. This was common enough
that `CLAUDE.md` carried a dedicated entry warning about it.

**Security pins drifted.** pnpm `overrides` are workspace-root-only, so each
root carried its own list and the lists diverged. `langsmith@<0.6.0` was pinned
in `langwatch` and `skills` but not at the root; `esbuild@<0.28.1` at the root
and in `skills` but not in `langwatch`; `hono`, `uuid`, `ip-address`, `qs`,
`form-data` and `js-yaml` only in `skills`. A package patched in one root could
stay vulnerable in another, and nothing announced the gap.

**Code could not be shared across roots.** `@langwatch/handled-error` and
`@langwatch/langy` were reachable only from the roots that happened to list
them. `typescript-sdk` could not depend on either.

Blocking the merge outright: **the application and the SDK had the same package
name.** `platform/app/package.json` was `langwatch@3.7.0`; `sdks/typescript/package.json`
was `langwatch@1.0.0`. pnpm rejects duplicate names in one workspace. The
collision had already produced a latent oddity — the application declared
`"langwatch": "1.0.0"`, a dependency on its own name, which resolved to the
published SDK only because the two lived in different workspaces.

The hard constraint on any change is the published `@langwatch/server` tarball.
It ships the application's source plus `platform/app/pnpm-lock.yaml`, and runs
`pnpm -C platform/app install --frozen-lockfile` on the end user's machine at first
boot (`packages/server/src/services/node-deps.ts`). Removing the application's
lockfile breaks `npx @langwatch/server` for every end user.

## Decision

**We will merge all six roots into a single pnpm workspace at the repo root,
with one lockfile.**

**We will rename the application package from `langwatch` to `@langwatch/web`.**
The directory stays `langwatch/` (later relocated to `platform/app/` by the
unrelated sdks/platform restructure, #6361). This is what unblocks the merge;
it also ends the self-referential dependency.

**We will keep the application on the published `langwatch@1.0.0` SDK.**
`linkWorkspacePackages` stays `false` (pnpm 10's default) and we now state it
explicitly in `pnpm-workspace.yaml`, because after the merge that default is
load-bearing rather than incidental: the SDK working copy is a workspace member,
and flipping the flag would silently switch what the application builds against.
Linking the working copy is a real improvement but a separate decision with its
own risk, and it is now a one-line change (`"langwatch": "workspace:*"`).

**We will publish `@langwatch/server` from a staging tree, with the whole
artifact nested one directory down.** The tarball carries
`pnpm-workspace.yaml`, `pnpm-lock.yaml` and every member's `package.json` under
`app/`; first boot runs

```sh
pnpm install --frozen-lockfile --filter "@langwatch/web..."
```

from `app/`. The application and its transitive workspace dependencies install;
the SDK, skills compiler and test suites do not.

The nesting is not cosmetic — it is the entire reason the artifact works.
**npm deletes `pnpm-lock.yaml` from the package root unconditionally**, the same
hardcoded rule that eats `.npmrc`. The exclusion is root-only: a lockfile one
directory down ships fine. The old layout only worked by accident of shape —
the lockfile lived at `platform/app/pnpm-lock.yaml`, already a subdirectory. A
single workspace puts it at the package root, where npm removes it, leaving the
end user's first boot with nothing for `--frozen-lockfile` to check.

Nesting costs nothing on the consuming side because the CLI already locates the
application by walking up for `platform/app/package.json`
(`locatePackageSource()` in `packages/server/src/services/app-dir.ts`), so it
finds `app/` by itself and every downstream path resolves unchanged.

`dev/scripts/pack-npm.sh` becomes the assembler. It reads `files` from
`package.json` — still the single source of truth for *what* ships — and decides
only *where* it lands. The two `.npmignore` files are deleted; their trimming
rules move into one explicit exclude list next to the copy that applies them.

## Rationale / Trade-offs

Three alternatives for the tarball were rejected before landing on staging.

Generating a standalone `platform/app/pnpm-lock.yaml` at pack time preserves the
end-user boot path byte-for-byte, but reintroduces two lockfiles that can
disagree, with the disagreement only observable in a published artifact — the
worst place to find it.

Shipping the lockfile under a name npm will not strip, and copying it back on
boot, works but is a rename dance: it leaves the artifact's layout coupled to
the repo's, which is the thing that broke here and would break again on the next
layout change.

Dropping `--frozen-lockfile` for end users adds nothing and removes a flag, but
it gives up reproducibility on precisely the install we control least.

`pnpm deploy` was investigated and does not help. `--legacy` (required, since
the workspace does not set `inject-workspace-packages`) emits no lockfile and
does not rewrite `workspace:*` specifiers, so the output is only usable if
`node_modules` ships with it — and it cannot, because `bcrypt`,
`@prisma/engines`, `sharp`, `msgpackr-extract` and `cpu-features` are native, so
one tarball cannot serve four platforms.

The longer-term answer is to stop shipping an install step at all: bundle the
server and ship native dependencies as per-platform `optionalDependencies`, the
way esbuild and swc do. That would delete most of the defensive machinery in
`node-deps.ts` and make first boot near-instant. It is deliberately not done
here — the observability stack depends on `import-in-the-middle` /
`require-in-the-middle` patching modules at runtime (which is why `.npmrc`
carries those two hoist patterns), and bundling defeats module patching by
construction. That is a rework of how instrumentation attaches, with its own
ADR, not a packaging change.

Merging the override lists was the fiddliest part, and there were more lists
than the workspace files suggested. pnpm reads overrides from **both**
`pnpm-workspace.yaml` and the root `package.json`'s `pnpm` field, and
`platform/app/package.json` and `sdks/typescript/package.json` each carried a
second, larger block that was live only while those directories were install
roots. Merged naively they go silently dead — pnpm ignores a `pnpm` field in a
non-root member — which would have quietly dropped around fifty pins, most of
them security ones. They are merged here and removed from the members.

Two classes of override behave very differently once shared. A **ranged** pin
(`pkg@<x: y`) only bites the versions it names, so it is safe to apply
repo-wide; all of them are merged as a union. An **unconditional** pin
(`pkg: version`) applies to everything, so a pin that suited one project can
break another. Three were deliberately not carried up, each a *direct*
dependency of the project that pinned it, so that project's own declaration
governs it just as well:

- `zod: ^4.0.14` from the SDK. The application is on `zod ^3.25.76` and
  `@langwatch/langy` is built to compile against it through the `zod/v4`
  subpath. Applying the SDK's pin globally would force the application onto
  zod 4 and break that arrangement. Three projects legitimately sit on three
  zod majors (app 3.x, SDK 4.0, MCP server 4.3); as direct dependencies pnpm
  gives each its own, which is exactly right.
- `@opentelemetry/api-logs: 0.205.0` and `@opentelemetry/sdk-logs: 0.205.0`
  from the SDK, both older than the application's OTel stack.

Where two roots pinned the same package differently we took the stricter value,
because the looser one was, by definition, leaving a project exposed:
`protobufjs` was `>=8.0.2` in the application and `skills` but `>=8.6.0` in the
MCP server, and `glob` was `>=10.5.0` in the MCP server but `^11.1.0` in the
application.

`vite` looked like a conflict and was not. The application's
`pnpm-workspace.yaml` carried an unconditional `vite: 8.0.10`, but its
`package.json` carried `vite@>=8.0.0 <8.0.16: >=8.0.16` as well — and that is
what the old lockfile actually resolved to. It contained 8.0.16 and 8.1.2 and
never 8.0.10, so the 8.0.10 hold was not biting at all. Keeping the ranges
preserves the resolution the application already ships, and leaves the 7.x line
`skills` needs untouched.

`minimumReleaseAge: 10080` was set only on the application's root. It now
applies repo-wide. This is a widening, and deliberate: a supply-chain age gate
that covers five projects out of six is not a gate.

The cost we accept is a single large lockfile. It will conflict more often in
merges, and someone who only wants to build the SDK now installs more than they
strictly need. Both are real; neither outweighs a fresh clone that works after
one command and a security pin that reaches every project.

## Consequences

- One `pnpm install` at the repo root covers every JavaScript project. The
  `CLAUDE.md` "install twice" entry is removed — it now describes a hazard that
  no longer exists.
- One `overrides` block. A security pin added there reaches every project, and
  cannot be silently absent from one.
- `mcp-server` is installed and built once per CI run instead of twice.
- `--ignore-workspace` disappears from `docs-ci.yml` and `e2e-ci.yml`.
- `@langwatch/handled-error`, `@langwatch/langy`, `@langwatch/redaction` and
  `@langwatch/ssrf` are declarable from any project in the repo, including the
  SDK and the skills compiler.
- The application's package name changes. Anything filtering it by name needs
  `@langwatch/web`; path-based invocation (`pnpm -C platform/app`) is unaffected.
- The tarball grows by every member `package.json` it did not previously carry
  (`packages/server`, `sdks/typescript`, `tests/agentic-e2e`) — a few kilobytes —
  and by the root lockfile. In exchange it stops carrying a second lockfile that
  could drift from the one the repo develops against.
- `npx @langwatch/server` installs from `app/` inside the tarball — the staged
  workspace root — rather than from `langwatch/`. `specs/npx-installer/`
  scenarios that describe the install location change with it.

## References

- Spec: `specs/setup/single-pnpm-workspace.feature`
- Related ADRs: [004](./004-docker-dev-environment.md) (dev environment)
- Tarball install path: `packages/server/src/services/node-deps.ts`
- Publish pipeline: `.github/workflows/npx-server-publish.yml`
