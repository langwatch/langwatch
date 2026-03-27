# ADR-014: Prompt Labels Data Model

**Date:** 2026-03-27

**Status:** Accepted

## Context

LangWatch needs a way to map named labels (e.g., `production`, `staging`) to specific prompt versions so users can control which version is served per environment without changing code. The prompt system already has `LlmPromptConfig` (the prompt) and `LlmPromptConfigVersion` (versioned snapshots). We needed to decide how to store the label-to-version mapping.

Three options were considered:

1. **JSON map column on `LlmPromptConfig`** — a `labels` JSON field like `{"production": "version-id"}`. Simplest, no new table, but no FK enforcement, harder to query across prompts, and concurrent updates to different labels can conflict.

2. **Labels as tags on `LlmPromptConfigVersion`** — a string array column on the version table. Simple, but "one version per label per prompt" is hard to enforce at the DB level, and moving a label requires updating two rows.

3. **Separate `LlmPromptConfigLabel` table** — a dedicated join table with `configId`, `name`, `versionId`, and a unique constraint on `(configId, name)`.

## Decision

We will use a separate `LlmPromptConfigLabel` table (option 3).

The `latest` concept is NOT stored as a label. It is resolved at query time by selecting the version with the highest version number. Only explicitly assigned labels like `production` and `staging` are persisted.

Built-in labels (`production`, `staging`) are created automatically when a new prompt is created, both pointing to the first version. The migration seeds these for all existing prompts.

## Rationale / Trade-offs

The separate table was chosen because:

- **DB-enforced uniqueness** via `UNIQUE(configId, name)` prevents duplicate labels without application logic.
- **Extensibility** — future features like custom labels, per-label RBAC, and label audit trails are straightforward to add without schema changes.
- **Query flexibility** — "which prompts have production pointing to version X?" is a simple WHERE clause, not a JSON path query.

The JSON column approach was simpler but traded away referential integrity and queryability. Since labels will have RBAC rules (who can create/move labels) and may grow in number, the relational model is a better foundation.

Not storing `latest` avoids a maintenance burden — auto-updating a label row on every version save adds transaction complexity for something that's trivially derived from `ORDER BY version DESC LIMIT 1`.

Labels are scoped to a prompt via `configId` rather than having a direct `projectId` column. Multitenancy is enforced transitively through the config's project ownership, which is the existing pattern for version-level data.

## Consequences

- A new Prisma model and migration are required.
- All label CRUD goes through dedicated service methods and tRPC endpoints.
- The REST API and tRPC `getByIdOrHandle` accept a `label` parameter; `version`/`versionId` and `label` are mutually exclusive.
- SDK updates to pass `label` parameters are a separate concern (not covered by this ADR).
- Future label features (custom labels, RBAC, audit log) build on this table without schema changes.

## References

- GitHub issue: #2698
- Parent epic: #2697
