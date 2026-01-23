# Repository + Service Pattern

Separate data access (Repository) from business logic (Service).

> "The Repository doesn't care which component is invoking it; it blindly does what it is asked. The Service layer doesn't care how it gets accessed, it just does its work, using a Repository where required."
> — [Tom Collings](https://tom-collings.medium.com/controller-service-repository-16e29a4684e5)

## Why This Pattern

1. **Separation of concerns** - Each layer has one job
2. **Testability** - Integration tests use real DB; unit tests cover pure logic only
3. **Clarity** - Obvious where new code should go
4. **Flexibility** - Swap implementations without affecting other layers

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

## Factory Pattern

Services use a static `create()` factory method:

```typescript
// In service class
static create(prisma: PrismaClient): DatasetService {
  return new DatasetService(
    prisma,
    new DatasetRepository(prisma),
    new DatasetRecordRepository(prisma),
    new ExperimentRepository(prisma),
  );
}

// Usage in router/controller
const service = DatasetService.create(ctx.prisma);
const result = await service.upsertDataset(params);
```

This encapsulates dependency wiring and allows easy testing with mocks.

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

export class DatasetConflictError extends Error {
  constructor(message = "A dataset with this name already exists") {
    super(message);
    this.name = "DatasetConflictError";
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
  if (error instanceof DatasetConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
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

```typescript
// Integration test - real database via testcontainers
it("creates dataset with generated slug", async () => {
  const service = DatasetService.create(prisma);
  const result = await service.upsertDataset({ projectId, name: "My Dataset" });
  expect(result.slug).toBe("my-dataset");
});

// Unit test - pure logic only, no database
it("resolves null model to default", () => {
  const config = resolveDefaults({ ...project, defaultModel: null });
  expect(config.defaultModel).toBe(DEFAULT_MODEL);
});
```

**Avoid mocking repositories** - it tests implementation details. If the service works with a real database, it works.

## References

- [Controller-Service-Repository](https://tom-collings.medium.com/controller-service-repository-16e29a4684e5) - Tom Collings
- [Should Controllers Reference Repositories or Services](https://ardalis.com/should-controllers-reference-repositories-services/) - Steve Smith
