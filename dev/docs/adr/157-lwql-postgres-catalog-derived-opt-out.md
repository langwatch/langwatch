# ADR-157: The PostgreSQL half of the LangWatchQL catalog is derived from the Prisma manifest, opt-out

**Date:** 2026-09-18

**Status:** Accepted

**Relates to:** [ADR-084](./084-lwql-postgres-mapping-tenant-predicate.md) (the approved-view / engine-table / tenant-predicate chain this ADR now generates for many tables instead of six), the ClickHouse opt-out precedent in [`lwql-derived-view-catalog.rules.ts`](../../../modules/analytics/process/src/rules/lwql-derived-view-catalog.rules.ts).

Behavioural contract: [specs/lwql/postgres-catalog.feature](../../../specs/lwql/postgres-catalog.feature).

## Context

ADR-084 settled the mechanism for reaching PostgreSQL-resident data from
LangWatchQL, and shipped it for six hand-picked tables: `annotations`,
`experiments`, `experiment_runs`, `projects`, `prompts`, `prompt_versions`. That
was the right scope for proving the mechanism, but it left the other ~130
Prisma models untouched, of which roughly 85 carry a tenant column and are
otherwise indistinguishable from the six that shipped. The gap surfaces
directly in the product: [#8207](https://github.com/langwatch/langwatch/issues/8207)
notes that a trace's `TopicId` is queryable but the topic name it resolves to
is not, because `Topic` was never added to the hand-written list. The same is
true of datasets, workflows, gateway objects, and every governance object —
each one absent from LangWatchQL for no reason other than nobody wrote its
view yet.

The issue states the product expectation plainly: every table a project can
access should be queryable through LangWatchQL. Exposure is meant to be the
default a new table gets automatically, not a decision someone has to
remember to make.

The ClickHouse half of the catalog already works this way. `derivedViews.ts` +
`defineDatasetFromTable.ts` (`deriveDefaultCatalog`) turn every ClickHouse
table into a view unless it is hand-written or listed in `skippedTables.ts`
with a reason, and `tenantTableCoverage.unit.test.ts` pins the count so a new
table cannot silently land in neither bucket. Postgres had no equivalent: its
catalog was a literal array of six `LangWatchQLPostgresMapping` entries with no
guard tying it to the schema at all.

## Decision

We derive the PostgreSQL half of the catalog from a generated Prisma manifest,
the same opt-out shape the ClickHouse half already uses.

**The manifest.** `catalog/prismaSchema.ts` parses `prisma/schema.prisma` text
into a typed `PrismaManifest` — models, fields, types, documentation, the
primary key. `scripts/generate-lwql-prisma-manifest.ts` writes it to
`catalog/prismaManifest.generated.json`, and
`prismaManifestParity.unit.test.ts` re-parses the live schema and asserts the
committed JSON still matches it — so the manifest cannot drift from the schema
it is supposed to describe.

**The derivation.** `derivePostgresCatalog({ manifest, skip, overrides })`
walks every model in the manifest and produces one
`LangWatchQLViewDefinition` per model, unless the model is listed in
`postgresSkippedModels.ts` with one of four reasons: no tenant column,
internal-only tenant, already exposed through another view, or access-control
plumbing. `tenantModelCoverage.unit.test.ts` is the guard: every model is
exactly one of derived or skipped-with-reason, with the counts pinned as
literals, so a new Prisma model that lands in neither bucket fails CI rather
than silently staying unreachable. The six hand-written views from ADR-084
become overrides on top of the same derivation — they keep their existing
names, descriptions, and column aliases, but they are no longer the only
tables the catalog can produce.

**Tenant scope.** Each model's tenant column is chosen narrowest-first:
`projectId` beats `teamId` beats `organizationId`; `Project` itself resolves
through its own `id`. A model with none of these columns needs an explicit
`tenantVia` override pointing at its parent, or it is skipped. Team- and
organization-scoped models fan out to one row per project by joining forward
through the approved view itself — `Team` joins to `Project` directly;
`Organization` joins through `Team` to `Project`, because `Project` carries
`teamId` and not `organizationId`, so the wording "joins through
`Project.organizationId`" that appeared in early drafts of the issue was
corrected. This join chain lives entirely inside the approved view's `FROM` /
`JOIN` clause. It decides which project ids a row is visible under; it does
not touch the row policy on the engine table or the tenant predicate on the
LangWatchQL view, which is why isolation is unaffected — see Rationale.

**Safe defaults.** Every derived view strips secret material (API keys,
access keys, tokens, hashes, credentials) and person identifiers (`email` and
`*Email` columns) outright — they never appear in `skipColumns`, they are
simply absent. Content columns are not dropped: they reuse the same
`defaultColumnGates` classifier the ClickHouse half already uses, so a body
column lands behind the `output` gate and a cost-shaped column behind the
`costs` gate, exactly like their ClickHouse counterparts. `userId`-like
columns are kept as opaque ids — a foreign key, never a name. `User`, `Team`,
and `Organization` are never derived at all; they are permanent entries in the
skip list under "access-control plumbing." An override that re-admits a
column the safe defaults would otherwise strip (`reAdmit`) must carry a
non-empty reason, checked the same way `postgresSkippedModels.ts` checks skip
reasons.

## Rationale / Trade-offs

**Why derive instead of hand-writing more views.** A hand-written list only
grows when someone remembers to grow it, which is exactly the failure that
left `Topic` unreachable. Deriving flips the review question: instead of
"should we add this table," the question for a new Prisma model becomes "why
is this one skipped," and that question has to be answered in
`postgresSkippedModels.ts` with a reason a test checks. The cost is that the
manifest and its parity test are now a load-bearing part of the catalog build,
where before the catalog was just a literal array — but the ClickHouse half
already carries that same cost and the coverage guard makes the failure mode
loud (a broken test) rather than quiet (a silently unreachable table).

**Why the fan-out lives in the view's join chain and not in the predicate or
the policy.** ADR-084's isolation argument rests on two things staying exactly
as they are: the row policy on the PostgreSQL-engine table, and the pushed-down
`TenantId` scalar-subquery predicate on the LangWatchQL view. Neither of those
changes for a team- or organization-scoped model. The join chain only decides
which `Project.id` values a row is stamped with as `TenantId` before either of
those mechanisms ever sees it — it is upstream of both, not a substitute for
either. So an organization-scoped table like `VirtualKey` produces one row per
project the organization owns, each carrying that project's `TenantId`, and
the existing predicate and policy filter exactly as before. This is also why
an organization-scoped row appearing once per project is by design and not a
bug: a `COUNT(*)` on an org-scoped view double-counts across the organization's
projects, and the generated description says so.

**Why content is gated, not dropped.** The gate exists precisely so a caller
can ask for a `String`/`Json` body column and be told to name it explicitly
rather than have it vanish with no explanation; the validator already refuses
`GATED_COLUMN` per [#8176](https://github.com/langwatch/langwatch/issues/8176/),
so reusing that classifier here is consistent with how the ClickHouse catalog
already treats the same shape of column, and it keeps a Postgres content
column from being either silently invisible (dropped) or silently exposed
(no gate at all).

**The cost this decision accepts.** `lwqlPostgresReaderConnectionLimit` stays
formula-driven, but its input — the number of mapped tables — grows from six
to 93, and the formula assigns about two connections per mapped table, for a
budget of roughly 189 (93 × 2 + 3). Infra has to size the reader role's
`CONNECTION LIMIT` and the primary's
`max_connections` for that new magnitude before this ships anywhere beyond the
Testcontainers harness. Separately, the SaaS render-config in
`langwatch-saas` is a third list — outside this repository — that mirrors the
catalog's shape and has to be updated by hand; it is not derived by this
change and is a known manual step, not an oversight.

## Consequences

- **Positive.** Topics, datasets, workflows, gateway objects, and governance
  objects become queryable. `docs/api-reference/query/overview.mdx` and
  `infra/clickhouse-serverless/internal/render/lwql_catalog.json` are
  regenerated from the catalog rather than hand-maintained, and both are
  parity-tested against it, so the published docs and the deployed render
  config cannot drift from what the catalog actually contains.
- **Negative.** The provisioning surface is bigger: more approved views, more
  engine tables, more row policies, all generated per model instead of
  hand-counted at six. The PostgreSQL connection budget grows with the
  catalog, and a caller reading through the schema door now finds 93
  Postgres-backed views instead of six, which is more for a human to read
  through even though each one follows the same shape.
- **Neutral.** The only hand-written artifacts left in the Postgres half of
  the catalog are the override files (`catalog/postgresOverrides/*.ts`) and
  the skip list (`postgresSkippedModels.ts`); every other Postgres view is a
  pure function of the Prisma manifest plus its override, the same relationship
  the ClickHouse half already has between `derivedViews.ts` and
  `skippedTables.ts`.
- **Per-user visibility.** A model whose *application* repository already
  restricts which rows a caller may read — Langy's conversations, visible to
  their owner plus anyone the owner shared with, never to every other project
  member — cannot rely on the catalog's tenant predicate alone: that predicate
  is project-scoped, and the reader role sees whichever rows the approved view
  admits regardless of which project member is asking. Such a model gets a
  `rowFilter` override (`PostgresDatasetOverride.rowFilter`), not a skip: the
  filter is rendered into the approved view's `WHERE` clause, which is the one
  layer downstream of the application code that can still enforce it once the
  data is reachable through LWQL.

## References

- Issue: [#8207](https://github.com/langwatch/langwatch/issues/8207)
- PR: [#8209](https://github.com/langwatch/langwatch/pull/8209)
- Related: [ADR-084](./084-lwql-postgres-mapping-tenant-predicate.md), [ADR-082](./082-lwql-analytics-views-invoker-column-grants-final-dedup.md)
- Spec: [specs/lwql/postgres-catalog.feature](../../../specs/lwql/postgres-catalog.feature)
- `modules/analytics/process/src/rules/lwql-postgres-catalog-derivation.rules.ts` — the derivation
- `modules/analytics/process/src/rules/lwql-postgres-skipped-models.rules.ts` — the skip list and its four reason categories
- `modules/analytics/process/src/rules/lwql-prisma-schema.rules.ts` — the manifest parser
- `modules/analytics/process/src/rules/__tests__/lwql-tenant-model-coverage.unit.test.ts` — the coverage guard
