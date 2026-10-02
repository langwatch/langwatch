# ADR-169: Browser state lint rules

**Date:** 2026-10-01

**Status:** Accepted. Superseded in part by ARCHITECTURE.md §10.2 (2026-10-01): one global UI store with
namespaced slices replaces the module-private store.

## Context

ARCHITECTURE.md §10.2 gives browser state four homes: React Query for server
data, the router for address-bar state, one global zustand store in
`browser-host`, each module writing only its own namespaced slice, and `useState` derived during render. Four plugin
rules hold that line in browser code.

## Decision

| Rule                                  | Layer  | Meaning                                                                                                                                |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `langwatch/effect-derives-state`      | plugin | An effect whose whole body copies a value derived from its dependencies into state is a second render; derive during render.           |
| `langwatch/query-data-in-state`       | plugin | Server data is not copied into `useState` or a store; it stays in React Query.                                                         |
| `langwatch/browser-store-containment` | plugin | zustand's `create` appears only under `behavior/`, and a module's `<name>.web.ts` exports no store.                                    |
| `langwatch/no-redux`                  | plugin | `redux`, `react-redux` and `@reduxjs/toolkit` are not imported in browser code.                                                        |

## References

- ARCHITECTURE.md §10.2 (Browser state)
- Spec: specs/tooling/lint-web-state.feature
