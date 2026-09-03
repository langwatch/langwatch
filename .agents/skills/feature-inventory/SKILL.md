---
name: feature-inventory
description: Map a LangWatch product domain across the app, packages, transports, persistence, workers, UI, tests, and docs before deciding or performing a feature split.
---

# Feature inventory

Use this skill for broad app review, ownership discovery, migration sequencing,
or when a proposed slice may duplicate an existing service or repository.

## Inventory

1. Read root `AGENTS.md`, the catalogue entry, and the owning ADR/spec.
2. Search the entire repository by domain nouns, route names, database models,
   event names, and public DTO fields. Do not inventory only the obvious folder.
3. Map:
   - current production files and package surfaces;
   - internal/public API routes and exact response schemas;
   - UI pages, components, hooks, and browser state;
   - worker, subscriber, process, projection, and command entry points;
   - services, repositories, stores, queries, caches, and external effects;
   - runtime construction, configuration, shutdown, and connection ownership;
   - tests, ADRs, specs, and developer docs; and
   - cross-feature dependencies and every use of global App/Prisma/env.
4. Identify duplicated ways of reading or writing the same domain data. Prefer
   one canonical service and repository graph when the lifecycle is the same.
5. Separate feature behaviour from UI/API/worker composition. Existing URL
   prefixes and database tables do not define feature ownership.

## Output

Provide an evidence-backed ownership map, the target service boundary, exact
composition obligations, and a ranked list of dependency-closed vertical
slices. Call out blockers and deliberate residuals. Do not create speculative
services or packages during an inventory.
