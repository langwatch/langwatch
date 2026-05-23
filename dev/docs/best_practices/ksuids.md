# KSUIDs for User-Facing Resource IDs

User-facing resource IDs (URLs, exports, support tickets, API contracts) use **KSUIDs with a per-resource prefix**, generated at the service / repository layer — not Prisma defaults.

```typescript
import { generate } from "xksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

const id = generate(KSUID_RESOURCES.MODEL_PROVIDER).toString();
// → "provider_2lT9b...sortable-by-creation-time"
```

## Why KSUID over nanoid / cuid

- **Sortable.** KSUIDs encode a creation timestamp, so a `ORDER BY id` matches `ORDER BY createdAt` close enough for pagination cursors without adding a second sort key.
- **Typed by resource.** The prefix tells you what kind of entity you're looking at in logs, error messages, and DB dumps. `provider_xyz` vs `eval_xyz` vs `monitor_xyz` is unambiguous; a bare nanoid is not.
- **Stable across regions.** No collision concerns even with concurrent writers in multiple data centers.

## When to use KSUID vs alternatives

| ID shape | Use when |
|---|---|
| `generate(KSUID_RESOURCES.X).toString()` at service/repo create | User-facing entities: anything that shows up in a URL, an API response, an export, or a webhook |
| `@default(nanoid())` / `@default(cuid())` left on the Prisma column | Internal join tables (`ModelProviderScope`, `ModelDefaultConfigScope`) — never shown to users, never linked to externally |
| Bare `nanoid()` in seed scripts / one-shot migrations | Deterministic ids during data lift, not used at runtime |

## Where to add a new resource type

`langwatch/src/utils/constants.ts`:

```typescript
export const KSUID_RESOURCES = {
  ...
  MODEL_PROVIDER: "provider",
  MODEL_DEFAULT_CONFIG: "mdcfg",
  ...
} as const;
```

Prefixes are short (≤8 chars), lowercase, no punctuation. Avoid abbreviations that collide with another resource's prefix; check the existing list first.

## Where the generation lives

The repository layer is the right place. Service decides "we need a new row," repository allocates the id + writes the row:

```typescript
// model-providers/modelProvider.repository.ts
async create(input: CreateModelProviderInput): Promise<ModelProvider> {
  return await this.prisma.modelProvider.create({
    data: {
      id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
      ...input,
    },
  });
}
```

Routes and services should never call `generate(KSUID_RESOURCES.X)` directly — that's a repository concern (see [repository-service.md](./repository-service.md)). Doing it at the route layer makes the id contract leak across the API boundary; tests that bypass the route end up with cuid-default ids and tests that go through the route get KSUIDs, and the discrepancy hides bugs.
