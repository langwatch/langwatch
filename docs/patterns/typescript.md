# TypeScript Patterns

## Service Methods

When creating service methods that wrap repository methods, use the `get` keyword:

```typescript
class MyService {
  get findById() {
    return this.repository.findById.bind(this.repository);
  }
}
```

Don't use `bind` directly as a property assignment.

## Type Safety

### Exhaustive Switch Statements

Always include exhaustiveness checks:

```typescript
function handleType(type: MyUnion): Result {
  switch (type) {
    case "a":
      return handleA();
    case "b":
      return handleB();
    default:
      const _exhaustive: never = type;
      throw new Error(`Unhandled type: ${_exhaustive}`);
  }
}
```

### Zod + TypeScript Types

Don't duplicate types. Define in Zod, infer for TypeScript:

```typescript
// Good
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});
type User = z.infer<typeof userSchema>;

// Bad - duplicated
interface User {
  name: string;
  email: string;
}
const userSchema = z.object({...}); // now they can drift
```

### Interface Location

- Options interfaces belong with the code that uses them
- Only extract to `types.ts` when shared across multiple files

```typescript
// Good - in prompts.facade.ts
interface GetPromptOptions {
  includeVersions?: boolean;
}

// Bad - in types.ts for single use
```

## Migrations

Always use the Prisma CLI for database migrations:

```bash
pnpm prisma migrate dev --name migration_name
pnpm prisma migrate deploy
```
