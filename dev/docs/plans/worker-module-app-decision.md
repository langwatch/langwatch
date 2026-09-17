# `apps/worker`, `apps/tasks` and the 984 `module-app-only-across-packages` findings

**Status: needs an owner decision. No lane can take it, and five have tried.**

This document exists because the owner asked for the constraints in one place in
order to design the fix. Everything below was verified directly, not taken from a
lane's report.

## What the rule is reporting

`module-app-only-across-packages` fires when a process imports a module's
**server** package instead of calling an operation on that module's `*Api`
contract. Example, from the worker:

> `AuthzGrantsCommandDispatcher` reaches `authz`'s server package directly.
> Import `AuthzApi` from `@langwatch/authz-contract` and call the operation on it
> instead.

## Where the 982 are

| location | findings |
| -------- | -------- |
| `apps/worker/` | 758 |
| `enterprise/packages/composition/` | 222 |
| **total** | **980** |

The worker's, by the module each import reaches into:

```
 138 `trace`
 124 `automation`
  67 `evaluation`
  57 `scenario`
  36 `workflow`
  31 `gateway`
  30 `stored-object`
  29 `model-provider`
  25 `governance`
  21 `notification`
  21 `langy`
  17 `data-privacy`
  17 `billing`
  16 `dataset`
  12 `ops`
  12 `coding-agent`
```

### A third process has the same problem (added 2026-09-17)

`apps/tasks` carries **60** of these findings, in the same shape: five
`src/platform/*.composition.ts` roots plus `src/tasks.catalogue.ts`, reaching
into fourteen modules' server packages.

```
stored-object 15 · identity 7 · scenario 6 · ops 6 · dataset 6
model-provider 4 · gateway 4 · billing 4 · authz 3 · and five more with one each
```

`apps/tasks` runs one-shot migrations and backfills. If installing a full module
graph is a poor fit for a queue worker, it is a worse one for a process that
exists to run a single backfill and exit. Whatever is decided for the worker
should be decided for this at the same time — they are one question asked in
three places.

## Why the obvious fix does not work

The fix the rule asks for is: call the operation on the module's contract instead
of importing its server internals. To call an operation on `TraceApi`, the worker
must **install the trace module**. Installing it is what it costs.

`TraceApp` (`modules/trace/server/src/app/trace.app.ts:509-517`) declares:

```ts
static readonly contract     = TraceApiToken;
static readonly dependencies = traceDependencies;
static readonly reads        = reads("clickhouse", "eventing", "logger", "redis", "rateLimiter");
```

The five members are fine — the worker already holds all of them. The problem is
`traceDependencies` (`modules/trace/server/src/app/trace-composition.types.ts:22`),
which names **thirteen peer modules by contract token**:

```
annotation · api-key · authz · coding-agent · data-privacy · data-retention
entitlement · evaluation · log · model-provider · project · share · topic
```

So the worker cannot call one `TraceApi` operation without installing trace and,
transitively, those thirteen and whatever they in turn require. A process that
stages spans on a queue would acquire the annotation module, the share module and
the API-key directory to do it.

That is the wall, stated precisely. It is not a permissions problem and not a
scoping problem — one lane was given `apps/worker` and `modules/trace` together
with explicit authorisation to extend `TraceApi`, and moved the worker by **one
finding**.

The enterprise composition packages hit the identical shape: their composition
adapters require governance, SCIM, gateway, webhook and trace **server**
implementations directly, and two lanes in a row reported it in those words.

## What five lanes established

| lane | scope | result |
| ---- | ----- | ------ |
| 1 | `apps/worker` alone | **+1** (removed 200 lines of genuinely dead code; no meter movement) |
| 2 | `apps/worker` alone | −20 |
| 3 | `apps/worker` **+** `modules/trace`, may extend `TraceApi` | **−1** on the worker |
| 4 | `enterprise/packages` | 0 on the composition packages |
| 5 | `enterprise/` both trees, told to skip these | −29 spent elsewhere, correctly |

Lane 3 is the informative one. It had exactly the permission the diagnosis said
was missing, and the wall did not move.

## The shape of the decision

This is a question about what `apps/worker` **is**, and there are at least three
defensible answers. It is not lint debt until one is chosen.

1. **The worker legitimately installs full module graphs.** Then the work is
   real, it is large, and it needs the thirteen-module install to be made
   cheap — or `TraceApp.dependencies` reduced, since a span-staging queue plausibly
   does not need `share` or `annotation`. The finding count is then a true
   backlog.

2. **A process composition root is not governed by this rule.** A root exists to
   wire implementations; requiring it to speak only in contracts may be the wrong
   constraint at that one layer. Then the rule should exempt
   `apps/*/src/app/*.composition.ts` and `enterprise/packages/composition/**` by
   name, with the reasoning recorded, and 982 findings disappear because they were
   never debt.

3. **The worker should not hold these graphs at all** — the queues that need
   trace operations belong behind a narrower seam than `TraceApi`. Then the work
   is a redesign of the worker's boundaries and the findings are a symptom.

**Nothing further should be spent on these 982 until this is decided.** They are
16% of the remaining meter, and every round that targets them returns
approximately zero.

## What to read next

- `dev/docs/adr/144-declarative-process-composition.md` — the ruling composition
  design, and its **2026-09-17 amendment (line 458)**, which already carves out
  the process-provided `EntitlementSource` factory from `LicensingApi`. That
  amendment is precedent for option 2: it is the same recognition that a process
  root holds something a contract cannot express.
- `.claude/skills/architecture-guide/references/config-composition.md`
- `dev/docs/plans/handover-2026-09-17-codex-lint-drive.md` for the drive context.
