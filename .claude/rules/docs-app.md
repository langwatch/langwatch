---
paths:
  - "apps/docs/**"
---

# Docs app (`apps/docs`)

Features, not modules: no contract, process half or `*Api`. Read `apps/docs/DESIGN.md`
"Feature layout" before adding a file; `langwatch/app-feature-layout` enforces it.

- A file sits in `src/features/<name>/<model|compile|ui|browser>/`, `src/lib/`, a top-level
  file, or the composition (`app/`, `site/`, `browser/`, `testing/`).
- `compile/` and `browser/` never import `ui/`; shared types and constants go down into `model/`.
- Another feature is imported only through `features/<name>/<layer>.ts`, re-exporting by name, and
  only when `package.json` `langwatch.features` declares the edge. The graph stays acyclic.
- An island entry (listed in `src/site/document.ts`) runs on load: never re-export it from an entry.
- Lint: `pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc apps/docs`.
