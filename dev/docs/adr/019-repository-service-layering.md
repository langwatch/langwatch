# ADR-019: Repository-service layering for project configuration access

**Date:** 2026-05-13

**Status:** Accepted

## Context

Two recent PRs surfaced an architectural tension around resolving project defaults (e.g. `defaultModel`, `embeddingsModel`):

- PR #1174 placed default resolution inside a new `ProjectRepository.getProjectConfig()`, returning project rows pre-filled with fallback values (`defaultModel ?? DEFAULT_MODEL`, etc.).
- PR #3537 placed default resolution inside `ProjectService.resolveDefaultModel(projectId)`, leaving the repository to return raw rows.

Both PRs touched the same files with different conventions, so the codebase needed a written rule for where this kind of logic lives.

The de-facto convention in `langwatch/src/server/app-layer/projects/` already follows the service-and-repository split: `project.service.ts` holds the business layer, and `repositories/project.repository.ts` is a pure data interface (with `NullProjectRepository` and `ProjectPrismaRepository` implementations). The convention was never written down.

## Decision

**Repositories return raw data. Services apply business rules — including default resolution, fallback chains, and any "if X is null, look at Y" logic.**

Concretely:

- Repository methods return DB rows as-is (or projections defined by the interface). They do not consult other entities or apply business defaults to enrich the response.
- Services that need a resolved value either fetch raw data from the repository and apply rules locally, or expose a focused resolver method (e.g. `resolveDefaultModel(projectId)`) that callers invoke explicitly.
- Callers that need raw values (e.g. settings UI that must distinguish `<empty>` from an auto-resolved guess) go straight to the repository. Callers that need an effective value go through the service / resolver.

## Rationale

- The DB stores `defaultModel: string | null`. The "if null, fall back to the first usable provider" rule is a business decision, not a data fact. Mixing it into the repository conflates "what is stored" with "what is effective" — and the distinction matters for settings UIs, debugging, and migrations that need to preserve null vs. non-null intent.
- Putting resolution in the service keeps the repository thin and testable in isolation (no testcontainers required to exercise resolution logic), lets the resolution strategy vary per caller, and aligns with the existing `app-layer/projects/{service.ts, repositories/}` structure.
- The alternative (repository owns resolution) was rejected because (a) it loses the raw view callers need for settings/debugging, (b) it ties resolution tests to DB setup, and (c) it creates ambiguity when multiple resolution strategies are needed (different defaults for prompts vs. evaluators vs. scenarios).

## Consequences

- **Positive:** Clear separation of concerns; raw vs. effective values are explicit at the type level; resolution is independently testable; one canonical place per resolved value (the service / resolver method).
- **Negative:** Slightly more verbose at consumer sites — callers must remember to call the resolver before use. Pre-resolving at the call boundary (passing the resolved value as a parameter rather than re-resolving at every internal step) becomes the conventional pattern.
- **Migration:** PR #1174 is restructured to drop the resolution-aware repository it introduced. PR #3537 (`ProjectService.resolveDefaultModel`) is the canonical service-layer resolver. Future PRs that need to resolve project defaults should extend the service, not the repository.

## References

- PR #1174 — initial proposal to centralize via a resolution-aware repository
- PR #3537 — service-layer `resolveDefaultModel` (canonical)
- `langwatch/src/server/app-layer/projects/` — de-facto convention this ADR codifies
- `dev/docs/adr/TEMPLATE.md` — template used for this file
