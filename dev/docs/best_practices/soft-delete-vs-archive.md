# Soft-Delete vs. Archive

## Policy

All resources that support "removal" from the UI should use **`archivedAt`** (archive/soft-exclude) rather than **`deletedAt`** (soft-delete).

### Why

- **Archive** means "still exists, but excluded from active queries." Archived records can be viewed in historical context (e.g., past suite runs) and can be restored.
- **Soft-delete** means "logically deleted." It is ambiguous whether the record should appear in historical views, and restoring it is an undefined operation.

### Current state

| Resource          | Field        | Pattern   | Notes                                     |
|-------------------|--------------|-----------|--------------------------------------------|
| Scenario          | `archivedAt` | Archive   | Correct                                    |
| Agent             | `archivedAt` | Archive   | Correct                                    |
| SimulationSuite   | `archivedAt` | Archive   | Correct                                    |
| LlmPromptConfig   | `deletedAt`  | Soft-delete | Needs migration to `archivedAt` ([#1889](https://github.com/langwatch/langwatch/issues/1889)) |

### Impact on suite runs

When a suite run is triggered, the service classifies each scenario and target as **active**, **archived**, or **missing**. Resources using `archivedAt` can be cleanly classified. Resources using `deletedAt` (like `LlmPromptConfig`) can only be "active" or "missing" -- they are never "archived" because the concept does not exist on the model.

### Guidelines

1. New resources that support removal should add an `archivedAt DateTime?` column.
2. Existing resources using `deletedAt` should be migrated to `archivedAt` when feasible.
3. Repository `findAll` methods should filter `archivedAt IS NULL` by default.
4. Provide `findByIdIncludingArchived` / `findManyIncludingArchived` variants for cases that need to see archived records.
