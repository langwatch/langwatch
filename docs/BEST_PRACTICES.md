# Best Practices

Coding patterns and principles for LangWatch development.

## Core Principles

Apply consistently: **SOLID**, **YAGNI**, **KISS**, **Clean Code**.

SRP (Single Responsibility) is the most important—every module, class, and function should have one reason to change.

## TypeScript Patterns

### Exhaustive Switch Statements

Always include exhaustiveness checks on union types:

```typescript
function handleAgentType(type: AgentType) {
  switch (type) {
    case "code":
      return handleCode();
    case "http":
      return handleHttp();
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled type: ${_exhaustive}`);
    }
  }
}
```

**Why:** TypeScript won't error on incomplete switches for `void` functions. The `never` assertion forces compile-time errors when new union members are added.

### Defensive State Initialization

Guard against unexpected nullish values from external sources:

```typescript
useEffect(() => {
  if (data) {
    setName(data.name ?? "");
    setUrl(data.url ?? DEFAULT_URL);
  }
}, [data]);
```

**Why:** DB schemas may allow nullable fields, API responses may be malformed. Defensive initialization prevents runtime crashes.

## Service Patterns

### Wrapper Methods

Use the `get` keyword for service methods that wrap repository methods:

```typescript
class UserService {
  constructor(private repo: UserRepository) {}

  get findById() {
    return this.repo.findById.bind(this.repo);
  }
}
```

Don't use standalone `bind()` calls to create these wrappers.

## Architecture

### When to Abstract

- **Do abstract:** When you have 3+ usages with identical patterns
- **Don't abstract:** For hypothetical future requirements or "just in case"
- **Prefer:** Three similar lines over a premature abstraction

### Validation Boundaries

- **Validate:** User input, external API responses, system boundaries
- **Trust:** Internal code, framework guarantees, typed function parameters
