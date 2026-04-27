# Repository + Service Pattern

Separate data access (Repository) from business logic (Service).

> "The Repository doesn't care which component is invoking it; it blindly does what it is asked. The Service layer doesn't care how it gets accessed, it just does its work, using a Repository where required."
> — [Tom Collings](https://tom-collings.medium.com/controller-service-repository-16e29a4684e5)

## The Three Layers

Code is organized into three layers. The **domain layer** (Service + Repository) is the core — it contains the business logic and knows how our product works. The other two layers are adapters that pass information between clients and the domain.

```text
┌─────────────────────────────────────────────────────────────┐
│  API Layer (Router/Controller)                              │
│  server/api/routers/suites/                                 │
│  Translates HTTP/tRPC requests → domain calls.              │
│  Handles auth, request validation, error mapping.           │
├─────────────────────────────────────────────────────────────┤
│  Domain Layer (Service + Repository)                        │
│  server/suites/                                             │
│  The core. Business rules, orchestration, data access.      │
│  Imports from nobody — both API and UI import from here.    │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (Components)                                      │
│  components/suites/                                         │
│  Translates domain data → things users see and click.       │
│  Fetches data via tRPC hooks (API layer).                   │
└─────────────────────────────────────────────────────────────┘
```

**Key rule:** Dependencies flow inward. The domain layer never imports from the API or UI layers. If a type (like `SuiteTarget`) or utility (like `parseSuiteTargets`) is needed by both the API router and the domain service, it belongs in the domain layer (`server/suites/types.ts`), and the router re-exports or imports from there.

## Why This Pattern

1. **Separation of concerns** - Each layer has one job
2. **Testability** - Integration tests use real DB; unit tests cover pure logic only
3. **Clarity** - Obvious where new code should go
4. **Flexibility** - Swap implementations without affecting other layers

## When to Use

| Layer | Responsibility | Examples |
|-------|----------------|----------|
| Router | Request/response handling, auth, error mapping | `suite.router.ts`, `dataset.router.ts` |
| Service | Business logic, orchestration, validation | `DatasetService`, `SuiteService` |
| Repository | Pure data access (CRUD), no business logic | `DatasetRepository`, `SuiteRepository` |

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

```text
src/server/datasets/
  dataset.repository.ts     # Data access
  dataset-record.repository.ts
  dataset.service.ts        # Business logic
  errors.ts                 # Domain errors
  types.ts                  # Domain types (Zod schemas, inferred types, parsers)
```

## Where Types Belong

Domain types live in the domain layer (`server/<feature>/types.ts`), not in the API layer.

```typescript
// GOOD: Domain type in domain layer
// server/suites/types.ts
export const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http"]),
  referenceId: z.string(),
});
export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

// Router re-exports from domain
// server/api/routers/suites/schemas.ts
export { suiteTargetSchema, type SuiteTarget } from "~/server/suites/types";
```

```typescript
// BAD: Domain type defined in API layer, imported by service
// server/api/routers/suites/schemas.ts   <-- defined here
// server/suites/suite.service.ts         <-- imports from API layer (wrong direction)
```

**Rule of thumb:** If a type represents a business concept (not just a request shape), it belongs in the domain layer. Request-specific schemas (like `createSuiteSchema` with its validation messages) can stay in the router schemas file since they're API concerns.

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
