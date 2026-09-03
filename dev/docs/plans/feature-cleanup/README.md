# Feature cleanup — progress

Three stages per feature, per the standard in
[`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).

| Stage      | What                                                                       | Writes                                  |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------- |
| 1 · review | Audit the feature against R1–R8                                            | `<feature>.md`                          |
| 2 · verify | Adversarially check the review: struck claims, missed problems, over-reach | `<feature>.md` (a Verification section) |
| 3 · enact  | Apply the verified review, commit by commit                                | source                                  |

Stage 1 and 2 are read-only over source. Stage 3 writes, and runs in small
batches because features share `platform/app/src/features/errors/logic/{codes,presentation}.ts`.

`dataset.md` is the reference review. The orchestrator builds dataset's
enactment by hand first; stage-3 agents copy that, they do not invent it.

## Status

| Feature                | Files | Lines | 1 · review | 2 · verify | 3 · enact            |
| ---------------------- | ----: | ----: | ---------- | ---------- | -------------------- |
| dataset                |    35 |  9147 | done       |            | commits 1-4          |
| secret                 |     9 |   639 | done       |            |                      |
| stored-object          |    22 |  2592 | done       |            |                      |
| api-key                |    24 |  4102 | done       |            | hidden-name list     |
| trace                  |   181 | 29990 | done       |            |                      |
| governance (ent)       |   143 | 24097 | done       |            | 3 layers cut         |
| scenario               |    90 | 16758 | done       |            |                      |
| gateway                |    79 | 16278 | done       |            |                      |
| langy                  |    85 | 15111 | done       |            |                      |
| authz                  |    51 | 13531 | done       |            | engine gate          |
| automation             |    78 | 10925 | done       |            | TS2554 fixed         |
| coding-agent           |    52 | 10059 | done       |            | registry + typecheck |
| analytics              |    30 |  9917 |            |            |                      |
| ops                    |    49 |  9508 |            |            |                      |
| organization           |    20 |  7885 |            |            |                      |
| experiment             |    40 |  7106 | done       |            |                      |
| identity               |    48 |  6956 |            |            |                      |
| model-provider         |    33 |  6595 | done       |            | REST statuses        |
| billing (ent)          |    42 |  6287 | done       |            |                      |
| prompt                 |    19 |  6156 |            |            |                      |
| webhook (ent)          |    20 |  5056 |            |            |                      |
| topic                  |    29 |  4783 |            |            |                      |
| github                 |    34 |  4668 |            |            |                      |
| evaluation             |    31 |  4284 |            |            |                      |
| dashboard              |    16 |  3889 |            |            |                      |
| scim (ent)             |    20 |  3860 |            |            |                      |
| workflow               |    16 |  3814 |            |            |                      |
| metric                 |    26 |  3334 |            |            |                      |
| suite                  |    22 |  3136 |            |            |                      |
| project                |    12 |  2740 |            |            |                      |
| annotation             |    11 |  2691 |            |            |                      |
| evaluator              |    14 |  2619 |            |            |                      |
| user                   |    11 |  2567 |            |            |                      |
| agent                  |    14 |  2269 |            |            |                      |
| data-retention         |    18 |  1792 |            |            |                      |
| role                   |    10 |  1658 |            |            |                      |
| feature-flag           |    16 |  1653 |            |            |                      |
| monitor                |     8 |  1605 |            |            |                      |
| share                  |    11 |  1601 |            |            |                      |
| licensing (ent)        |    16 |  1571 |            |            |                      |
| log                    |    13 |  1366 |            |            |                      |
| sso (ent)              |     5 |  1202 |            |            |                      |
| auth                   |     9 |   971 |            |            |                      |
| presence               |     9 |   731 |            |            |                      |
| data-privacy           |     6 |   391 |            |            |                      |
| entitlement            |     5 |   338 |            |            |                      |
| managed-provider (ent) |     7 |   305 |            |            |                      |
| audit-log (ent)        |     5 |   206 |            |            |                      |
| notification           |     5 |   114 |            |            |                      |

49 features, 268,000 lines of feature-server source. 15 reviewed, 7 partly enacted.

Every feature package typechecks clean — server, contract, web and separate
test configs — as of `c078e26d88`. That was not true before it: the test-move
commit left `coding-agent-server` with ten TS2352s that main does not have.

Stage 1 fans out; stage 3 does not, until the dataset enactment is finished by
hand — agents copy a proven reference, they do not discover a design.

---

# Working rules

Everything below is the part an agent needs to pick this up without
rediscovering it. It replaces a 1,760-line append-only round log; the log's
only durable content was the rules and the hazards, and they are here.

## The shape being applied

A feature module is **one class**, not a bag of functions with a class beside
it. For the four server layers — port, repository, service, adapter — and
the typed-Prisma seam, read
[`service-repository-adapter-port.md`](../../best_practices/service-repository-adapter-port.md)
once. The `typed-prisma-seam` lint rejects any new file that reintroduces the
old `database: object` + `as PrismaClient` seam.

- **One class per file**, named for what it is (`GatewaySpendFilters`,
  `TrackedEventSync`), never for being a utility. `IdUtils` became
  `SpanRecordIdentity`.
- **Entry points public, steps private.** If folding leaves every member
  public, say why in the class docblock — usually a framework registers
  module-level handlers that reach in. A named class with a reason beats loose
  functions; an unexplained one is just a namespace.
- **Never re-export.** Repoint every consumer at the new name. Three-layer
  facades (module fn → class alias → module const) have been found and removed
  twice; do not add a fourth layer to avoid touching callers.
- **A repository comes into a service**, not a client. Repositories use
  `findAll`/`findById`; services use `getAll`/`getById`; routes call services.
- **Shared utilities stay functions** when they are genuinely shared and have
  no state — but one home, not one per caller.

## The fold procedure

1. **Survey the consumers first**, across all four roots: `packages`,
   `platform/app/src`, `apps`, and tests. Grep for **every** name you are
   moving, not a subset.
2. **Check what each consumer imports the name FROM.** A same-named symbol
   reached through a different module is the one hazard nothing else catches
   (see #3 below).
3. Fold, then rewrite call sites, then rewrite import blocks.
4. **Verify** — all four, every time:
   - `pnpm --filter @langwatch/<pkg> typecheck` → 0
   - `pnpm --filter @langwatch/<pkg> test` → green
   - **sabotage a member and watch the right test fail**
   - `pnpm --filter @langwatch/architecture-lint lint` → still 821, nothing traded
5. **Format only the files you touched.** `oxfmt` on a directory reformats
   everything not already oxfmt-clean; that has produced 45-file phantom diffs
   twice.

## The six rewrite hazards

In the order they bite. Every one of these has actually happened here.

1. **Prose.** A `\s*\(` lookahead matches `categorical (evaluation_runs)` in a
   docblock. Use `\(` with no whitespace.
2. **Declarations.** The same pattern rewrites a _declaration_ as readily as a
   call — a port's type literal, a class's own member, a consumer with a method
   of the same name, a fixture with a function of the same name.
3. **Same name, different module.** Fifteen `platform/app` tests import
   `applySpanToSummary` from a _fixture_ that binds a runtime; repointing them
   at the class of the same name would have compiled and tested the wrong
   function. Only "which module does this import come from" catches it.
4. **Collisions.** `collectDroppedCategories`, `wrap`, `hasPersistableSignal`,
   `groupByColumn` — same name, unrelated function, four times.
5. **Spread calls.** `...originAttrs(` is preceded by a dot, so a plain
   `(?<![.\w])` lookbehind skips it.
6. **Bare references that are not calls.** `when: hasSyncableEvaluations,` in a
   pipeline definition. Sweep for the name _not followed by_ `(`, tracking
   whether you are inside an import block — do not filter by "line ends in a
   comma", which hides exactly these.

## Two things the checks do not cover

- **`pnpm typecheck` does not read test files.** `tsconfig.tsgo.json` excludes
  `**/__tests__/**`. A mangled test declaration is caught only by running the
  suite.
- **`platform/app` and `apps/**` are not in the package typechecks**, and
  `apps/**` runs no CI at all. Consumer surveys must include them explicitly;
  three stale `apps/api` imports were found that way.

## Duplicated code is untested code

The strongest pattern this cleanup has produced. Of the duplicate pairs found
so far, most had **zero** coverage on either copy — each copy looks like the
other's coverage, so neither gets a test. Sabotaging the survivor takes a
minute and has never once been wasted.

Find them with a body-hash sweep (hash every function body of 5+ lines across
`packages`, `platform/app/src`, `apps`; report collisions across files). Re-run
it after each round; it is cheap and it has been the highest-yield check here.

**Consolidating a security check is only safe in one direction: strictly no
looser.** When two copies disagree, keep the stricter behaviour and pin the
difference with a test rather than picking a side — which permission or bound
is correct is a product decision.

## Where the loose functions are now

Measured at `a48f86df5e`, feature packages only:

| directory                                | functions | note                                          |
| ---------------------------------------- | --------: | --------------------------------------------- |
| transport                                |       210 | route handlers — mostly the framework's shape |
| adapters                                 |       159 | ~0.55 per file                                |
| repositories                             |       158 | ~0.6 per file                                 |
| services                                 |       133 | ~0.4 per file                                 |
| subscribers                              |        45 | was 81                                        |
| intents                                  |        23 |                                               |
| projections / ports / processes / stores | < 20 each |                                               |

The concentration is gone: the largest single file holds seven, and most hold
one or two — a `create` helper beside its class, or a genuinely shared utility.
**Folding is no longer the highest-value work.** Duplication sweeps and the
divergence docs below are.

## Open, and needing a decision rather than an edit

- **[`analytics-clickhouse-divergence.md`](analytics-clickhouse-divergence.md)**
  — mostly fixed. Nine `.integration.test.ts` files plus
  `join-time-bound-partition-column.unit.test.ts` still point at the dead
  modules; moving them needs integration infrastructure in the package first.
  **Read this before investigating the analytics duplication — it has been
  found and diagnosed twice.**
- **data-privacy**: 37 exported names overlap between
  `platform/app/src/server/data-privacy/` (2,114 lines) and
  `@langwatch/data-privacy-contract` (478). `buildDataPrivacyChain` and
  `resolveDataPrivacy` are byte-identical, and unlike analytics **both sides
  are live**. Same extraction-in-progress shape; not attempted.
- **model-provider write permission**: three places answer "what does writing a
  project-scope model provider require" — the service checks `project:update`
  (member-level), the tRPC declaration and platform/app's legacy path both say
  `project:manage` (admin-level). Pinned by tests, docblock corrected, **the
  permission deliberately unchanged**.
- **`isBlocklisted`** and its 23-key payload blocklist are identical in the
  trace and analytics packages, which do not depend on each other.
  Consolidating needs a new cross-feature dependency edge.

## The general pattern behind the divergences

`legacy-feature-fragment` has 464 entries naming a file that exists in both
trees. Extraction hits a type or helper it cannot import, widens or
re-implements to get unblocked, and **the tests stay with the original**. The
tell is cheap: for each pair, which copy has importers, and which has the
tests. When those differ, the tests are guarding nothing.

Confirmed instances so far: monitor preconditions, analytics ClickHouse, and
(unfixed) data-privacy.
