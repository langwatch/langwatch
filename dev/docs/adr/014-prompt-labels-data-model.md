# ADR-014: Prompt Labels Data Model

**Date:** 2026-03-27

**Status:** Accepted (revised)

## Context

LangWatch needs a way to map named labels (e.g., `production`, `staging`) to specific prompt versions so users can control which version is served per environment without changing code. The prompt system already has `LlmPromptConfig` (the prompt) and `LlmPromptConfigVersion` (versioned snapshots). We needed to decide how to store the label-to-version mapping.

Three options were considered:

1. **JSON map column on `LlmPromptConfig`** — a `labels` JSON field like `{"production": "version-id"}`. Simplest, no new table, but no FK enforcement, harder to query across prompts, and concurrent updates to different labels can conflict.

2. **Labels as tags on `LlmPromptConfigVersion`** — a string array column on the version table. Simple, but "one version per label per prompt" is hard to enforce at the DB level, and moving a label requires updating two rows.

3. **Separate `PromptVersionLabel` table** — a dedicated join table with `configId`, `versionId`, `label`, and a unique constraint on `(configId, label)`.

## Decision

We use a single `PromptVersionLabel` table (option 3) with a hardcoded label vocabulary.

### Key design rules

- **Only two valid labels: `production` and `staging`** — validated in the repository layer, not in the database. This keeps the schema simple and avoids a label-definition table.
- **No `latest` in DB** — resolved at query time by selecting the version with the highest version number. Only explicitly assigned labels are persisted.
- **Two REST patterns for label assignment** — labels in create/update payloads (assign to new versions) and a dedicated `PUT /:id/labels/:label` sub-resource (move labels between existing versions). Plus a tRPC `assignLabel` mutation.
- **No archiving** — reassignment updates the existing row (upsert on `configId_label`).
- **No built-in label seeding** — labels are not auto-created when a prompt is created. They are only created when explicitly assigned.
- **Unique constraint: `(configId, label)`** — one version per label per prompt.
- **Audit fields: `createdById`, `updatedById`** — nullable, track who assigned/reassigned.

### Model

```prisma
model PromptVersionLabel {
  id          String   @id @default(nanoid())
  configId    String
  config      LlmPromptConfig        @relation(fields: [configId], references: [id], onDelete: Cascade)
  versionId   String
  version     LlmPromptConfigVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  label       String   // "production" or "staging" — validated in code
  projectId   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now()) @updatedAt
  createdById String?
  updatedById String?

  @@unique([configId, label])
  @@index([configId])
  @@index([versionId])
  @@index([projectId])
}
```

## Rationale / Trade-offs

The separate table was chosen because:

- **DB-enforced uniqueness** via `UNIQUE(configId, label)` prevents duplicate labels without application logic.
- **Query flexibility** — "which prompts have production pointing to version X?" is a simple WHERE clause, not a JSON path query.
- **Referential integrity** — FK constraints on both `configId` and `versionId` with cascade delete.

Hardcoding the label vocabulary (production, staging) in code avoids over-engineering. Custom labels can be added later by widening the validation, no schema change required.

Not storing `latest` avoids a maintenance burden — auto-updating a label row on every version save adds transaction complexity for something trivially derived from `ORDER BY version DESC LIMIT 1`.

## Revision History

**v2 (2026-03-27):** Simplified from the original design:
- Renamed table from `LlmPromptConfigLabel` to `PromptVersionLabel`
- Renamed `name` column to `label` for clarity
- Removed label CRUD endpoints (createLabel, listLabels, updateLabel, deleteLabel) — replaced with single `assignLabel` upsert
- Removed built-in label auto-seeding on prompt creation
- Removed `LabelConflictError` and `LabelNotFoundError` (upsert eliminates conflicts; `NotFoundError` covers not-found)
- Hardcoded valid labels to `production` and `staging` only (was open-ended with regex validation)

**v3 (2026-03-27):** Added REST API surface with both patterns:
- `PUT /:id/labels/:label` sub-resource — move a label to an existing version (like PromptLayer)
- Optional `labels` array in `POST /` and `PUT /:id` payloads — assign labels to newly created versions (like Langfuse)
- Both patterns are needed: sub-resource for label promotion without version changes, payloads for label assignment during version creation

## Revision History — v4 (2026-03-31): Custom label definitions (issue #2821)

Added the `PromptLabel` table for org-scoped custom label definitions:

```prisma
model PromptLabel {
  id             String       @id @default(nanoid())
  organizationId String
  organization   Organization @relation(...)
  name           String       // validated: lowercase, starts with letter, non-numeric
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @default(now()) @updatedAt
  createdById    String?
  createdBy      User?        @relation("promptLabelCreatedBy", ...)

  @@unique([organizationId, name])
  @@index([organizationId])
}
```

New API surface added:
- `POST /api/orgs/:orgId/prompt-labels` — create custom label (admin only)
- `GET /api/orgs/:orgId/prompt-labels` — list built-in + custom labels
- `DELETE /api/orgs/:orgId/prompt-labels/:labelId` — delete custom label + cascade assignments

Built-in labels (`latest`, `production`, `staging`) are still not stored in the database.
`PromptVersionLabel.label` remains a plain string (no FK to `PromptLabel`). Validation was widened to accept custom labels via org lookup.

## Deferred Scope

The following are explicitly deferred to future issues:

- **FK from PromptVersionLabel.label to PromptLabel** — currently a plain string with soft validation. A FK would enforce referential integrity but requires migrating existing rows.
- **Label edit/rename** — changing a label name requires updating all assignments. Not implemented.
- **RBAC** — per-label permissions (who can assign/reassign). See #2713.
- **Archiving** — soft delete on both definitions and assignments.
- **Label description field** — nice-to-have on the definition table.

### API Surface

The label feature follows both Langfuse's "labels in create payload" pattern and PromptLayer's "dedicated sub-resource" pattern:

| Method | Path / Endpoint | Description |
|--------|----------------|-------------|
| `PUT` | `/api/v1/prompts/:id/labels/:label` | Move a label to an existing version |
| `POST` | `/api/v1/prompts` | Create prompt with optional `labels` array (assigned to v1) |
| `PUT` | `/api/v1/prompts/:id` | Update prompt with optional `labels` array (assigned to new version) |
| `GET` | `/api/v1/prompts/:id?label=production` | Fetch the version a label points to |
| `GET` | `/api/v1/prompts/:id?version=2` | Fetch a specific version by number |
| `GET` | `/api/v1/prompts/:id` | Fetch latest version (highest version number) |
| tRPC mutation | `prompts.assignLabel` | Assign or reassign a label directly |
| tRPC query | `prompts.getByIdOrHandle` | Fetch with optional `label` param |

`version`/`versionId` and `label` are mutually exclusive — providing both returns 422.

## Consequences

- A single Prisma model and migration are required.
- Label assignment is available through both REST and tRPC with upsert semantics.
- Labels can be assigned at prompt creation time via the `labels` array in the REST create payload.
- SDK updates to pass `label` parameters are a separate concern (not covered by this ADR).
- Future label features (custom labels, RBAC) build on this table by widening the validation or adding permissions.

## References

- GitHub issue: #2698
- Parent epic: #2697
