# Service, repository, adapter, port

The four words this repo uses for the layers of a feature package. Each one
has a specific job, and the shape of every feature-cleanup lands here. Read
this before extracting a feature or adding a new persistence-backed one.

## The four in one line each

- **Port** — a promise, written down. An `abstract class …Port` declaring
  what a service needs from the world.
- **Repository** — the class that answers a port against a persistent store.
  The only file that names `PrismaClient` (or `ClickHouseClient`, etc.).
- **Service** — the class with the feature's decisions. Takes ports through
  its constructor; the same class is unit-tested with a memory port and
  runs in production with the Prisma one.
- **Adapter** — the one-line wiring builder for a specific backing. Takes
  the process's typed database client, constructs the repository, hands it
  to the service, returns the service.

## The dependency direction

Nothing outside the adapter needs to know a repository class exists. Nothing
below the adapter needs an untyped seam.

```
composition root (apps/api, platform/app)
    │  holds a real PrismaClient
    ▼
Postgres<Subject>Adapter.create(prisma)          ← adapters/postgres.<subject>.adapter.ts
    │  builds the repository, hands it to the service
    ▼
<Subject>Service.create(port)                    ← services/<subject>.service.ts
    │  the class that owns decisions
    ▼
<Subject>Port                                    ← ports/<subject>.port.ts (abstract)
    ▲
    │  extends
Prisma<Subject>Repository                        ← repositories/prisma/prisma.<subject>.repository.ts
    │  imports PrismaClient
```

Only two files may `import { PrismaClient }` from `@langwatch/prisma-client/generated`:
the repository and the Postgres adapter. That's what the `prisma-containment`
policy enforces.

## What each file looks like

### Port

```ts
// packages/features/<feature>/server/src/ports/<subject>.port.ts

export type <Subject>Row = Readonly<{ …portable fields… }>;

export abstract class <Subject>Port {
  abstract find(id: string): Promise<<Subject>Row | null>;
  abstract insert(row: <Subject>Row): Promise<void>;
}
```

- Class name ends in `Port` (`strict-port-module` enforces this).
- The `.port.ts` file exports only abstract classes and portable types.
  No values, no runtime code.
- Method names are storage verbs — `find`, `findAll`, `insert`, `update`,
  `delete`. Not business verbs.

### Repository

```ts
// packages/features/<feature>/server/src/repositories/prisma/prisma.<subject>.repository.ts

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { <Subject>Port } from "../../ports/<subject>.port";

export class Prisma<Subject>Repository extends <Subject>Port {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): Prisma<Subject>Repository {
    return new Prisma<Subject>Repository(prisma);
  }

  async find(id: string): Promise<<Subject>Row | null> { … }
}
```

- **Typed** `PrismaClient` in and out. No `object`, no cast.
- Extends the port; every abstract method is answered.
- `static create(prisma)` — never a public constructor.
- The barrel does NOT export this class (`private-runtime-export`
  enforces).

### Service

```ts
// packages/features/<feature>/server/src/services/<subject>.service.ts

import { <Subject>Port } from "../ports/<subject>.port";

export class <Subject>Service {
  private constructor(private readonly repository: <Subject>Port) {}

  static create(repository: <Subject>Port): <Subject>Service {
    return new <Subject>Service(repository);
  }

  async setSomething(id: string, value: number): Promise<void> {
    if (!isValid(value)) throw new SomethingOutOfRangeError(value);
    await this.repository.update({ id, value });
  }
}
```

- Depends on the **port**, not the repository.
- Method names are business verbs — `setMaxDurationDays`, `revokeAll`,
  `resolve`. Not `find`, `insert`.
- Owns the decisions: range checks, invariants, refusals, coordination.
- Throws `HandledError` for cases the caller can act on.
- Never reaches Prisma. Never reaches a framework. The service that runs
  in production is the same class a unit test constructs with a memory
  port.
- The barrel EXPORTS this class.

### Adapter

```ts
// packages/features/<feature>/server/src/adapters/postgres.<subject>.adapter.ts

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Prisma<Subject>Repository } from "../repositories/prisma/prisma.<subject>.repository";
import { <Subject>Service } from "../services/<subject>.service";

export class Postgres<Subject>Adapter {
  static create(prisma: PrismaClient): <Subject>Service {
    return <Subject>Service.create(
      Prisma<Subject>Repository.create(prisma),
    );
  }
}
```

- Named `Postgres<Subject>Adapter` (or `ClickHouse…`, `S3…`) — the backing
  is in the class name.
- One method, `static create`, returns a fully-built service.
- **Typed** `PrismaClient` in. The composition root already holds one;
  give it the type it has.
- The barrel EXPORTS this class.

### What the composition root calls

```ts
// platform/app/src/server/app-layer/app.ts (or apps/api composition)

import { Postgres<Subject>Adapter } from "@langwatch/<feature>-server";

this.<subject> = Postgres<Subject>Adapter.create(prisma);
```

One line. The composition never names the repository, and never sees an
untyped `object`.

## What NOT to do

### Do not take `database: object` and cast it back

The old convention did this:

```ts
static create(database: object): Postgres<Subject>Adapter {
  return new Postgres<Subject>Adapter(database as PrismaClient);
}
```

It works, and it hides a class of mistakes: a caller can hand an `object`
that isn't a `PrismaClient` and the failure only shows up when a method is
called. The seam is untyped.

The `typed-prisma-seam` lint catches both `as PrismaClient` and
`database: object` in a `.create(` argument list, on any repository or
Postgres adapter file. Fifty-four existing files (before Aug 31 2026) are
baselined — the baseline is shrink-only, so a new file lands red until
the seam is typed.

Sabotage the rule any time you doubt it: add a `.create(database: object)`
to a new adapter and watch it fail lint.

### Do not export the repository from the barrel

`private-runtime-export` enforces this. The barrel exposes the adapter
and the service; the repository is a private implementation detail. If a
caller needs a Postgres-backed service, they call the adapter.

### Do not put decisions in the repository

If the repository has an `if` that isn't a Prisma predicate, the decision
belongs in the service. The repository loads and stores rows; the service
decides what to do with them.

### Do not put persistence in the service

If the service has a Prisma call, the persistence belongs behind a port. A
unit test that has to mock Prisma to test a service is a signal the seam
moved.

### Do not skip the adapter to save a file

You need it. It's what keeps `PrismaClient` out of the composition-facing
surface and the port free of a concrete constructor. One line of adapter
is not overhead — it's the seam that lets the barrel stay clean.

## When there's no persistence

Not every feature has a repository. A service that composes other services,
or one whose only inputs are function arguments, doesn't need a port or an
adapter. Compose it directly in the app layer:

```ts
this.<subject> = <Subject>Service.create({ …dependencies… });
```

The adapter shape exists because a persistent store is a swappable
implementation detail. When there's nothing to swap, don't invent an
adapter.

## Related

- `dev/docs/plans/feature-cleanup/README.md` — the feature-by-feature sweep
  that produces this shape.
- `dev/docs/best_practices/feature-cleanup-review.md` — the R1–R8 review
  criteria; the layers here answer R1.
- `packages/architecture-lint/src/typed-prisma-seam.ts` — the rule.
- `packages/architecture-lint/src/prisma-boundaries.ts` — the containment
  policy naming both permitted places for `PrismaClient`.
