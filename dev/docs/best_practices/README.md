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
- **ai-sdk.md** - Vercel AI SDK 7: `instructions` not system messages, telemetry registration, and the breakages the typechecker cannot see
- **lwql-workbench.md** - LangWatchQL workbench + LangWatchQL Vega-Lite chart patterns: request-state discipline, backend-only validation, value fidelity, the chart governance chain, the lazy Vega boundary
- **logging-and-tracing.md** - Logging infrastructure and context propagation
- **local-observability.md** - Local LGTM stack (Grafana/Loki/Tempo/Prometheus); querying logs/traces as an agent with `gcx`
- **dependency-age-gates.md** - Dependency release-age gates and emergency security exceptions
- **vitest-performance.md** - Vitest pool/isolation settings and the RAM guardrails they protect
- **typescript.md** - TypeScript patterns
- **react.md** - React/Next.js patterns
- **git.md** - Git workflow
