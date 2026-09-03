# Best Practices

Project coding conventions. See also `../TESTING_PHILOSOPHY.md`.

## Files

- **repository-service.md** - Repository + Service layer pattern
- **scoped-resources.md** - Storage + read + UI pattern for org/team/project-scoped rows
- **scope-selector-and-badges.md** - Shared scope picker + chips (org/team/project/department)
- **row-actions-overflow-menu.md** - Vertical 3-dot overflow menu for per-row edit/delete/archive
- **icon-button-labels.md** - Pair icon buttons with a text label; when icon-only is OK
- **copywriting.md** - User-facing copy: write for first-time customers, never leak internals or history
- **inline-fix-links.md** - Links to settings from a working context open in a new tab
- **ops-dashboard.md** - Ops surfaces: space is proportional to trouble; identifiers, dual-axis charts, cross-tenant controls
- **list-table.md** - Shared look for resource index tables
- **drawers.md** - URL-routed drawers
- **async-processing-ui.md** - Poll/banner/read-gate pattern for a processing→ready/failed resource
- **soft-delete-vs-archive.md** - When to archive vs hard-delete
- **error-handling.md** - When to throw a HandledError, what to put on it, how the client renders it
- **logging-and-tracing.md** - Logging infrastructure and context propagation
- **local-observability.md** - Local LGTM stack (Grafana/Loki/Tempo/Prometheus); querying logs/traces as an agent with `gcx`
- **dependency-age-gates.md** - Dependency release-age gates and emergency security exceptions
- **vitest-performance.md** - Vitest pool/isolation settings and the RAM guardrails they protect
- **typescript.md** - TypeScript patterns
- **react.md** - React/Vite SPA patterns (routing, screens vs hosts)
- **git.md** - Git workflow

## Amendment, 2026-09-03: `platform/app` is gone

Every path in these documents that starts `platform/app/` — or, in an older
example written from inside that package, bare `src/server/...`,
`src/components/...`, `src/pages/...` and similar with no `platform/app/`
prefix at all — names a file that no longer exists. The pattern each one
illustrates is unchanged; only its address is, so the documents are amended
here rather than rewritten one by one — a rewrite would touch dozens of
examples whose point was never the path.

Read a `platform/app/...` (or bare `src/...`) path as its owner in the new
layout:

| Was                                                          | Read as                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `platform/app/src/server/<feature>/**`                       | `packages/features/<feature>/server/src/**`                                                   |
| `platform/app/src/{components,hooks,features}/**`            | `packages/features/<feature>/web/src/**`, or `apps/ui/src/**` for the shell                   |
| `platform/app/src/server/app-layer/**`, `src/runtime/app/**` | `apps/api/src/app/**` (the API's composition root)                                            |
| `platform/app/src/workers.ts`, `src/runtime/worker/**`       | `apps/worker/src/app/**`                                                                      |
| `platform/app/src/pages/**`                                  | `apps/ui/src/**` routes                                                                       |
| `platform/app/vitest*.config.ts`                             | each package's and application's own `vitest.config.ts`                                       |
| `platform/app/scripts/**`                                    | `dev/scripts/**` for the dev loop; a `task:*` script on `apps/api` or `apps/worker` otherwise |
| `platform/app/prisma/**`                                     | `packages/prisma-client/prisma/**`                                                            |
| `platform/app/.env`                                          | `.env` at the workspace root                                                                  |

Two documents change meaning rather than address, and are corrected in place
above: the component/datastore integration LANE SPLIT no longer exists (each
package declares what it needs in its own vitest config), and the dev server no
longer tees to a single `server.log` (`pnpm dev` prints to its own terminal;
the local LGTM stack is where the durable copy lives).
