# Repository + Service Pattern

Separate data access (Repository) from business logic (Service).

## When to Use

| Layer | Responsibility | Examples |
|-------|----------------|----------|
| Repository | Pure data access (CRUD), no business logic | `DatasetRepository`, `ProjectRepository` |
| Service | Business logic, orchestration, validation | `DatasetService`, `PromptService` |

## Repository Layer

Thin wrapper over the database. No business logic.

```typescript
// langwatch/src/server/datasets/dataset.repository.ts
export class DatasetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOne(input: { id: string; projectId: string }): Promise<Dataset | null> {
    return await this.prisma.dataset.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
  }

  async create(input: CreateDatasetInput): Promise<Dataset> {
    return await this.prisma.dataset.create({ data: input });
  }
}
```

**Repository rules:**
- Constructor takes only database client
- Methods are simple CRUD operations
- No default resolution or business validation
- Can include project-scoping guards at data level

## Service Layer

Business logic, orchestration, default resolution.

```typescript
// langwatch/src/server/datasets/dataset.service.ts
export class DatasetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DatasetRepository,
    private readonly recordRepository: DatasetRecordRepository,
    private readonly experimentRepository: ExperimentRepository,
  ) {}

  static create(prisma: PrismaClient): DatasetService {
    const repository = new DatasetRepository(prisma);
    const recordRepository = new DatasetRecordRepository(prisma);
    const experimentRepository = new ExperimentRepository(prisma);
    return new DatasetService(prisma, repository, recordRepository, experimentRepository);
  }

  async upsertDataset(params: UpsertDatasetParams) {
    // Business logic: resolve name, check conflicts, migrate columns
    const resolvedName = name ?? (await this.resolveExperimentName(projectId, experimentId));
    // ... orchestrate repositories
  }
}
```

**Service rules:**
- Use `static create()` factory method for instantiation
- Orchestrate multiple repositories
- Apply business rules, validation, default resolution
- Throw domain-specific errors (see below)

## Domain Errors

Services throw framework-agnostic errors that routers map to HTTP/tRPC errors:

```typescript
// langwatch/src/server/datasets/errors.ts
export class DatasetNotFoundError extends Error {
  constructor(message = "Dataset not found") {
    super(message);
    this.name = "DatasetNotFoundError";
  }
}
```

```typescript
// In router - map to tRPC errors
try {
  return await service.upsertDataset(input);
} catch (error) {
  if (error instanceof DatasetNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}
```

## File Structure

```
src/server/datasets/
  dataset.repository.ts     # Data access
  dataset-record.repository.ts
  dataset.service.ts        # Business logic
  errors.ts                 # Domain errors
  types.ts                  # Shared types
```

## Decision Checklist

| Question | Answer |
|----------|--------|
| Is it storage/retrieval? | Repository |
| Is it exposing functionality (HTTP, tRPC)? | Router/Controller |
| Is it unique business logic? | Service |
| Need CRUD only? | Repository |
| Need default resolution? | Service |
| Need to orchestrate multiple entities? | Service |
| Need validation beyond schema? | Service |

## Testing

Follow the [Testing Philosophy](../TESTING_PHILOSOPHY.md):

| Test Type | What to Test | Database |
|-----------|--------------|----------|
| **Integration** | Service + Repository together | Real (testcontainers) |
| **Unit** | Pure logic only (e.g., `resolveDefaults`) | None needed |

**Avoid mocking repositories** - it tests implementation details. If the service works with a real database, it works.
