# Feature cleanup review

The standard for auditing one feature package for over-abstraction, and the
shape the cleanup takes. Every reviewer, every re-reviewer and every
implementer works from this file and from the worked example,
[`dev/docs/plans/feature-cleanup/dataset.md`](../plans/feature-cleanup/dataset.md).

The goal is code that is **simple to read and simple to use**. It does what it
does well, it does not try to do more, and a reader can follow a request from
the transport to the database without opening seven files.

## The rules

### R1 — A service never holds a database client

A service takes a **repository**, never `PrismaClient`, never
`Prisma.TransactionClient`, never a ClickHouse client. The repository is the
only thing that speaks to a datastore.

```ts
// WRONG
class ThingService { constructor(private readonly prisma: PrismaClient) {} }

// RIGHT
class ThingService { constructor(private readonly things: ThingRepository) {} }
```

A service that needs a transaction takes a repository method that owns the
transaction, or a unit-of-work the repository hands it. It does not reach for
`$transaction` itself.

Repositories use `findAll` / `findById` / `create` / `update` / `delete`.
Services use `getAll` / `getById`. Transports call the app or a service, never
a repository.

### R2 — Classes, not modules of functions

Behaviour lives in a class. A module that exports several functions which all
take the same two or three collaborators **is** a class whose constructor was
never written; every call site re-passing `prisma`, `storage` and `repository`
is the proof.

Free functions are allowed for **shared pure utilities** — no I/O, no
dependencies, used by more than one caller. `stripNullBytes`, `chunkKey`,
`slugify`. Put them in `utils/`. A pure helper used by exactly one class is a
private method on that class.

### R3 — No pass-through layers

A method whose whole body is `return this.other.sameMethod(input)` earns
nothing. If a class is mostly such methods, it is a layer, not a component.

The feature layout allows exactly one facade: `app/<feature>.app.ts`, the class
both transports call, so a REST handler and a tRPC procedure cannot answer
differently. That one is required. A **second** facade underneath it is not.

Count before you cut: if N of a class's M methods are one-line delegations and
the class holds no rules of its own, the class goes.

### R4 — A port needs two implementations

Keep a port when it has **two or more real implementations**, or when the single
implementation lives in a **different package** (a genuine inversion — the
feature must not depend on the app).

Delete a port whose only implementation sits beside it in the same package. It
is a seam to nowhere, and it usually exists so some service can hold it as an
optional field — see R5.

`ports/*.port.ts` must export an abstract class whose name ends in `Port`
(`strict-port-module`). Renaming the file and the class is one change or
neither.

### R5 — Required dependencies are required

An optional constructor dependency that production always supplies is not
optional. It converts a compile-time guarantee into a runtime throw:

```ts
if (!this.options.uploads) throw new Error("Upload capability is not configured");
```

Find the composition root, see what it actually passes, and make the type say
that. Optionality that exists only so tests can build partial objects is paid
for by every reader and by the next person to hit that throw in production.

### R6 — Knowable failures are `HandledError`

If we can name the cause and the caller can act on it, it is a `HandledError`
with a stable `code`, a customer-safe `message`, a correct `fault`, and an entry
in `apps/ui/src/model/errors/presentation.ts` keyed by that code.
Add the code to `features/errors/logic/codes.ts` (sorted) in the same change.

A plain `Error` subclass forces every transport to re-derive the status. The
tell is a `Record<string, {status, code}>` keyed on `error.name`, or an
`instanceof` ladder in a router, or both — the same knowledge in three places,
one of them string-keyed, silently broken by a rename.

Infrastructure failures stay plain `Error` and degrade to "unknown" with a trace
id. Do not dress them up.

### R7 — Comments explain this code, briefly

Keep: why a line is surprising, an invariant, what a non-obvious loop is doing,
a unit or an ordering that matters. Four lines is usually enough.

Move to an ADR: incident narratives, superseded designs, rollout notes,
fleet-capacity arithmetic, "the analogue of X one aggregate over".

Delete: anything restating the signature, and any comment naming a file path —
those rot. `identity-command-id.ts` still points at
`packages/authz-server/src/ledger/grant-identity.ts`, which no longer exists.

A comment must be true of the code beneath it. If it is not, the comment is the
bug.

### R8 — Say it once

The same operation declared in a contract interface, a service, an app facade
and a port is four restatements to keep in step. Duplicated helpers (`isRecord`
is defined ten times across features) get one home.

An `export *` in `index.ts` publishes everything; check what consumers actually
import and export that.

## What NOT to touch

- A port with real polymorphism. `DatasetStorage` has three implementations
  (S3, Azure, local); it stays.
- One-file-per-member sets that are genuinely open — one canonicaliser per
  vendor, one adapter per provider. New members arrive without touching the
  others. That is correct.
- Hot correctness paths, where the module is already inside its quality ceiling
  and the only complaint is method length. Say so and move on.
- Anything under `platform/` — that tree is deleted; files go in `packages/**` or `apps/**`.

## Deliverable

Write `dev/docs/plans/feature-cleanup/<feature>.md` with these sections:

1. **What is there now** — file/line counts, and the layer stack as an ASCII
   diagram from transport to datastore. Name every layer and its method count.
2. **Problems** — numbered, each with **file:line evidence**. A claim without a
   path and a line number does not count. Say which rule (R1–R8) it breaks.
3. **What it should look like** — the target tree with per-file line estimates,
   and real code sketches for the two or three biggest moves.
4. **Keep list** — what you deliberately are not changing, and why.
5. **Cost and order** — the commits, smallest-risk first, each leaving the
   suite green.
6. **Blast radius** — how many files outside the feature import it, and which
   symbols they use.

Be specific and be honest. A review that says "could be cleaner" is worthless.
A review that says "22 of 26 `DatasetApp` methods are one-line pass-throughs;
`app/dataset.app.ts:226-300`" can be acted on.

If a feature is already clean, say so in five lines and stop. Do not invent work.
