---
name: feature-map
description: "Maintain the canonical LangWatch feature map (feature-map.json at the repo root) and its human-readable companion FEATURE_MAP.md. Use when adding or renaming a feature, a REST namespace, a UI route, an MCP tool, a CLI command or a user-facing skill, so the central registry keeps naming what the code actually serves. Every entry is validated against the code that provides it."
user-invocable: true
argument-hint: "[what changed, e.g. 'added dataset MCP tools']"
---

# Maintain the feature map

`feature-map.json` at the repo root is the product's public information architecture:
ten top-level categories, each with `children`, each child a feature with its `surfaces`.
`FEATURE_MAP.md` is the coverage table derived from it — edit both in one change. Use the
underscore form; never create `FEATURE-MAP.md`.

A **feature** here is a customer-facing capability, a row in this map, named the way a
user would name it. It is not the same thing as a **module** (`packages/features/<name>`,
the contract/server/web package trio); one feature can be served by several modules, and
one module can serve several features.

## The entry shape

```json
{
  "id": "observability.tracing",
  "name": "Tracing",
  "description": "Capture LLM calls, spans, inputs/outputs, costs, and latency",
  "surfaces": {
    "code": {
      "sdk": { "python": "…", "typescript": "…", "go": "…" },
      "cli": ["trace search"],
      "hints": {},
      "skill": "tracing",
      "docs": "https://…"
    },
    "platform": { "ui": "/traces", "mcp": ["search_traces"], "skill": null, "docs": null },
    "api": "/api/collector",
    "docs": "https://…"
  },
  "sync": "code-to-platform",
  "produces": ["traces"],
  "consumes": []
}
```

- `code` is what a developer writes in their own project; `platform` is the UI and MCP.
  `api` and `docs` are cross-cutting.
- Values are namespaces, not methods: `"langwatch.experiment"` means the module.
- `sync`: `null` (one mode only), `"bidirectional"`, `"code-to-platform"`,
  `"platform-to-code"`. Future intent goes in `plannedSync`, never in `sync`.
- `hints` carries a copy-pasteable example per CLI command.
- No aspirational entries. If the code does not serve it, it is not in the map.

## Where each surface actually comes from

| Field             | Verify against                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaces.api`    | `packages/features/<f>/server/src/transport/public-rest/` and `transport/api-rest/`, mounted by `apps/api/src/api-<f>-rest.feature.ts` or `apps/api/src/app-rest/app-rest.packaged-families.ts` |
| tRPC namespaces   | `apps/api/src/app-trpc/app-trpc.features.ts`                                                                                                                                                    |
| `platform.ui`     | `apps/ui/src/model/ui-route-table.ts` (the `path` of a route descriptor)                                                                                                                        |
| sidebar placement | `apps/ui/src/features/chrome/`                                                                                                                                                                  |
| `platform.mcp`    | `mcp/typescript/src/create-mcp-server.ts` (`registerTools`) over `mcp/typescript/src/tools/`                                                                                                    |
| `code.cli`        | `sdks/typescript/src/cli/commands/` — one directory per command group, `sdks/typescript/src/cli/index.ts` is the entry                                                                          |
| `code.skill`      | `skills/<name>/SKILL.md` (the user-facing skills, not `.claude/skills`)                                                                                                                         |
| `code.sdk`        | `sdks/python/src/langwatch/__init__.py`, `sdks/typescript/src/index.ts`, `sdks/go/`                                                                                                             |

## Updating

1. Read `feature-map.json`, find the feature by `id` (dotted: `category.feature`).
2. Add the value to the right surface array or field. A brand-new feature gets a whole
   entry under the category whose mental model it belongs to — the hierarchy is the
   product's, not the code's.
3. Mirror the change in `FEATURE_MAP.md`.
4. Validate every field you touched against the table above with `ls` / `grep -rn`
   (ripgrep is unreliable in this repo). An entry that names something the code does not
   serve is worse than a missing one.
5. A route rename must update this file: it is a live surface, not documentation.

## Report

The entries added or changed, the code path each was validated against, and anything you
found in the map that the code no longer serves.
