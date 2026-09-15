# Architecture cleanup work packets

**Inventory, 2026-09-07.** This is a sequencing document, not a rewrite plan. Production TypeScript below `apps/{api,worker}` and core/Enterprise feature packages was scanned; generated files and tests were excluded except where parity is named. The inventory itself was read-only; guard implementation status below reflects the subsequent correction batch.

## Inventory and boundaries

| Area | Result | Meaning |
| --- | ---: | --- |
| Catalogue features (`modules/catalogue.json`) | 54 | This is the ownership authority; the scan covers all its core feature entries plus Enterprise feature packages. |
| `feature.json` files outside nested web metadata | 67 | Filesystem layout is broader than the catalogue because it includes Enterprise and transitional/residual roots. |
| Feature `*.server.ts` declarations | 40 | Installer adoption is incomplete/uneven. |
| Current API + worker application `*.composition.ts` | 130 / 36,833 LOC | Current `find`/`wc` count excluding `__tests__`; hand-written process graphs remain the principal owner. |
| Current API / worker production composition | 4,824 / 2,329 LOC | Current file sizes; both retain feature construction, optional fallbacks and transport wiring. |
| Architecture lint | Full run remains red with 324 existing `boundary-signature-mirrors` findings; the corrected tree has zero Enterprise SPDX placement findings. Transport/app-contract/composition findings remain backlog clusters. | Mechanically verified clusters, not one defect each; the two new guards have 24 focused tests. |

The lint output includes dirty-branch work and is therefore a selection signal rather than a baseline.

**Guard status.** `enterprise-source-license` now enforces the explicit
`LicenseRef-LangWatch-Enterprise` header placement signal: production source
under `apps` or core feature trees must move under the owning Enterprise
feature, while historical provenance without that marker is not inferable.
`boundary-signature-mirrors` covers the named feature contract/App and process
composition boundaries with TypeScript AST checks for global signature utility
types and nested `unknown`/`any` assertions. Both guards are implemented and
reviewed by 24 focused tests; no additional duplicate guard is proposed here.

**Coordination exclusions.** Auth, identity and SSO are in a separate PR. Trace governance/provenance is root-owned. Its correction moves source policy into Enterprise Governance and shares authenticated-key protection through OTLP. Composition now accepts Governance policy, but default deployments without a Governance instance still refuse ingestion-source keys with 503. Do not take that work in any packet below.

Every server packet finishes at the ADR-133 boundary: Apps own private services/repositories; `FeatureSetup` gets typed infrastructure/config plus complete peer APIs; transports use `ctx.app`/ `context.app`. Preserve URL/RPC shape, authorization, errors, fields, ordering and side effects with characterization tests.

### Accepted code shapes to copy

Small, cohesive transformations may use plain functions. Behaviour that coordinates
persistence, policy, dependencies or effects belongs in services, repositories and
adapters with real responsibilities. Use private construction and `static create`
for those concrete collaborators. Avoid both giant utility modules and chains of
forwarding wrappers. Extract a collaborator because it owns behaviour, not merely
to divide a large file. Review readability separately from passing checks.

The current executable declaration is not hypothetical: `modules/coding-agent/server/src/coding-agent.server.ts:9-16` declares both REST and tRPC routers and contributes them with `withTransports`; `modules/data-retention/server/src/data-retention.server.ts:8-13` is the one-transport form. The current valid small App is audit-log at `modules/audit-log/server/src/app/audit-log.app.ts:20-48`:

```ts
type AuditLogSetup = FeatureSetup<
  typeof AuditLogApp.dependencies,
  AuditLogInfrastructure,
  AuditLogConfig
>;

export class AuditLogApp implements AuditLogApiContract {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};
  static readonly repositories = { entries: PrismaAuditLogRepository };
  static readonly configSchema = auditLogConfigSchema;

  readonly #service: DefaultAuditLogService;

  private constructor(service: DefaultAuditLogService) {
    this.#service = service;
  }

  static create({ infrastructure, config }: AuditLogSetup): AuditLogApp {
    const repository = PrismaAuditLogRepository.create(infrastructure.database);
    return new AuditLogApp(
      DefaultAuditLogService.create({ repository, maxArgsBytes: config.maxArgsBytes }),
    );
  }

  record(command: RecordAuditLogCommand): Promise<void> {
    return this.#service.record(command);
  }
}
```

New packets must follow that declaration/factory/private-service shape, rather than importing a feature transport from an API process list.

The current transport framework accepts handler facts such as `input`, `app`, `actor`, `scope`, and `signal` (`packages/architecture-enforcer/src/api-transport-framework.ts:48-61`). Its raw-context guard is the accepted boundary: handlers must consume only those parser/policy-produced facts.

No raw `ctx`, `context`, `req`, `request`, `session`, headers, or response object belongs in that callback. Keep validation and authorization at the transport boundary; handlers receive the resulting typed facts.

Repository construction remains private to setup; the actual accepted seam is a typed constructor/factory at the adapter, not an exported `Pick<PrismaClient>`:

```ts
class PrismaExampleRepository extends ExampleRepository {
  readonly #database: PrismaClient;

  private constructor(database: PrismaClient) {
    super();
    this.#database = database;
  }

  static create(database: PrismaClient): PrismaExampleRepository {
    return new PrismaExampleRepository(database);
  }
}
```

The `PrismaDepartmentRepository` current shape at `enterprise/modules/governance/server/src/repositories/prisma/prisma.department.repository.ts:18-24` is the closest existing repository factory, but its exported narrowed database type is precisely the P12 cleanup target.

## Dependency graph

`P1 -> P2/P3 -> P4/P5/P6 -> P7/P8/P9 -> P10/P11 -> P12`. P13 and P14 can run after P1 independently.

## Work packets

### P1 — Execute declared transport contributions (Terra)

**Evidence — mechanically verified.** Forty server declarations exist, while coding-agent, annotation and data-retention use `withTransports`; API REST imports feature factories and app service types directly at `apps/api/src/app-rest/app-rest.process-features.ts:4-90`. Lint reports 797 `api-transport-through-framework` findings.

**Change.** Complete the runtime adapter that mounts `withTransports(...)` contributions using a typed context of App, policy decorator and request facts. The three current declaration examples are coding-agent, annotation and data-retention; convert one small reference feature (share or api-key) end-to-end first. Do not put business calls in the runtime adapter.

**Accept / test.** Declaration mounts nothing; boot creates one App; route calls `ctx.app`; worker can reuse the factory; direct process import disappears for the reference feature. Run runtime-composition tests, reference package checks, architecture lint, Oxfmt/Oxc and `git diff --check`.

### P2 — Retire API ProductionComposition as feature registry (Terra)

**Evidence — mechanically verified.** `apps/api/src/app/api-production.composition.ts:623-844` holds scores of `composed*` fields; it boots audit inline at `852-860`, conditionally builds feature graphs at `865-903`, and exposes tenancy/rest ports/optional collaborator selection/Prisma at `1458-1501`. ADR-133 measures 53 fallback functions, 101 unavailable errors and 50 absence reporters.

**Umbrella outcome, not one agent task.** API boot eventually declares selected features and infrastructure once and retains only listener/lifecycle ownership. Move each `compose*Feature` into its owning installer; required graph absence fails at boot and an omitted role contribution is explicit config.

**First bounded slices (do these separately after P1):**

1. `apps/api/src/app/api-production.composition.ts:852-860` plus the API root created by P1: audit-log already uses `auditLogServer`, but in a **second nested `createApp` runtime**. Install it in the API's one selected feature graph, obtain `AuditLogApi` from that graph, and remove only the nested runtime/resource owner.
2. `apps/api/src/app/api-production.composition.ts:865-870` plus `modules/feature-flag/server/**`: move feature-flag fallback/config into installer setup and delete only `composedFeatureFlag` use in that slice.
3. `apps/api/src/app-rest/app-rest.process-features.ts:4-90` plus the P1 reference feature: remove exactly one direct feature transport/service import and mount its declared contribution.

**Accept / test.** No public feature service/repository/Prisma lookup; each selected App is created once; transport mounting cannot construct a second graph; missing declared dependency fails before listener start. Characterize readiness, stop order and unavailable-route mapping; run API composition integration/typecheck and standard checks.

### P3 — Retire WorkerProductionComposition as feature registry (Terra)

**Evidence — mechanically verified.** `apps/worker/src/app/worker-production.composition.ts:411-450` builds infrastructure, mutates connected-agent runtime, and creates mail/webhook services. `1481-1511` converts absent feature graphs into method failures and mirrors signatures with `Parameters`.

**Umbrella outcome, not one agent task.** Worker boot eventually selects installers plus explicit worker contributions. Feature setup owns resources; global registration becomes an explicit lifecycle adapter. Remove absence adapters only after each feature states required versus omitted worker contribution.

**First bounded slices (do these separately after P1):**

1. `apps/worker/src/app/worker-production.composition.ts:421-434`: isolate `installWorkerConnectedAgentRuntime` behind a named process lifecycle adapter; prove stop/failed-boot cleanup.
2. `apps/worker/src/app/worker-production.composition.ts:435-450`: make mail and webhook egress explicit infrastructure contributions, without moving their business callers.
3. `apps/worker/src/app/worker-production.composition.ts:1493-1511`: convert only evaluation/scenario command forwarding to installed API tokens; P5 owns scenario implementation.

**Accept / test.** Import/constructor starts no work; registration seals after installation; failed start drains in reverse order; no `refuse()` represents a graph boot should reject. Add lifecycle tests for success, failed start and no-consumer role; run worker tests/typecheck and standard checks.

### P4 — Governance ingestion worker contribution (Terra)

**Evidence — mechanically verified.** `apps/worker/src/app/worker-governance-ingestion.composition.ts:32-47` accepts a raw multi-repository Prisma intersection, `Pick<FeatureFlagService>`, and a foreign project port. `76-117` builds the whole graph and has three `unknown as Parameters/ConstructorParameters` bridges; `131-153` mirrors port signatures.

**Change.** Add an Enterprise governance installer worker contribution with semantic SSRF config, private Prisma adapters, complete Project/FeatureFlag APIs, and named egress/AWS adapters. Make event registration a typed contribution.

**Accept / test.** No raw Prisma intersection, service Pick, cast or signature mirror; pull cannot bypass SSRF fence; all source/run data is organization/project scoped; Enterprise-only install. Preserve schedule/retry/checkpoint/OCSF ledger in worker integration tests; run governance+worker checks.

### P5 — Scenario execution worker contribution (Terra)

**Evidence — mechanically verified.** `apps/worker/src/app/worker-scenario-execution.composition.ts:161-194` manually builds services and accesses Prisma at `173-176`. Its prefetch dependency bag is `Pick<WorkerScenarioExecutionPrerequisites,...>` at `206-218`; absence uses a `Parameters` mirror at `150-155`.

**Change.** Scenario installer owns processor graph and private adapters; declare model/project/simulation peer APIs; inject Redis, child-process config and telemetry as typed infrastructure. Keep the dedicated subscriber connection as an owned resource.

**Accept / test.** One processor per worker; no raw client in setup; stop closes duplicate Redis; failed prefetch preserves retry/error mapping. Characterize cancellation, prefetch and child cleanup; run scenario server and worker composition tests.

### P6 — Stored-object worker substrate boundary (Luna)

**Evidence — mechanically verified.** `apps/worker/src/app/worker-object-storage.composition.ts:30-57` exports `Pick<PrismaClient,"project">`, AWS runtime, project source, Azure config and payload staging as one process bag.

**Change.** Keep storage technical infrastructure process-owned but supply small typed infrastructure ports through setup: storage runtime, payload staging and tenant S3 resolver. Project lookup comes from its actual owner; do not fabricate a storage feature.

**Accept / test.** No exported Prisma slice or concrete Azure config crosses a feature boundary; BYOC/global bucket and lazy Azure credentials are unchanged. Characterize BYOC, absent Azure and payload staging; run stored-object/dataset focused tests.

### P7 — Organization App and tRPC callback bag (Terra)

**Evidence — mechanically verified.** `modules/organization/server/src/transport/api-trpc/organization.api.ts:85-108` defines local `app.organizations` context; its `OrganizationTrpcPorts` begins at `132` with auth, membership, billing and onboarding callbacks. `app/organization.app.ts:6-10` imports generated Prisma and duplicates row transport types at `91-99`.

**Change.** Put real callable use cases on `OrganizationApi`; App privately owns organization/membership services and receives complete Authz/Project APIs. Move actor extraction/access declarations to governed middleware and use `ctx.app`. Contract owns output schemas/types.

**Accept / test.** No callback bag/raw context/generated Prisma outside private repositories; target organization authorization covers members/invites/teams/groups; preserve legacy names, pagination, ordering and redaction. Run organization contract/server plus API family integrations.

### P8 — Prompt API vocabulary and Project dependency (Terra)

**Evidence — mechanically verified.** `modules/prompt/contract/src/prompt.api.ts:31-170` exposes duplicate verbs (for example `getAllPrompts/listForProject`) and `Omit<CopyPromptCommand,"authorId">`. `app/prompt.app.ts:42-46` injects `PromptService` and `Pick<ProjectService,...>`. Lint also reports prompt-web cycle and 13 public-boundary leaks.

**Change.** Name canonical API operations; retain old public names only as transport shims until callers migrate. Replace utility-derived inputs with explicit contract commands and depend on ProjectApi. Reverse prompt-web surface implementation imports in the same slice.

**Accept / test.** One implementation per operation, no Pick/Omit boundary mirror or prompt-web cycle; REST/tRPC bytes for prompt, tag and copy operations are unchanged. Run prompt contract/server/web, REST+tRPC integration and lint.

### P9 — Gateway explicit command and actor boundary (Terra)

**Evidence — heuristic candidate.** `modules/gateway/server/src/app/gateway.app.ts:142-186` derives operation inputs with conditional `infer`; `GatewayActor` is `unknown` at `47`. This conflicts with the repository ban on type mirrors/untyped boundary values, but is not a dedicated lint finding.

**Change.** Put named virtual-key/budget/cache/guardrail commands and branded actor input in gateway contract. REST/tRPC maps credentials at the governed edge; App authorizes exact organization/project targets.

**Accept / test.** No inferred operation aliases or unknown actor crosses App boundary; REST/tRPC virtual-key scope RBAC and idempotency remain identical. Run gateway checks and `apps/api/src/app/__tests__/api-virtual-key-scope-rbac.integration.test.ts`.

### P10 — Ops explicit audit command and process ports (Terra)

**Evidence — mechanically verified.** `apps/api/src/features/ops/ops.composition.ts:332-346` casts audit data through `unknown as Parameters<ApiAuditPort["record"]>[0]`; `378` accepts `Pick<OpsApp,"isAdmin">`. `modules/ops/server/src/app/ops.app.ts:87-174` embeds large process explorer interfaces; absence policy is duplicated at API lines `80-105`.

**Change.** Define audit command/operator actor in ops contract. Supply event-store/replay introspection as named process infrastructure ports; keep OpsApp callable. Select absent capability behaviour at boot.

**Accept / test.** No audit cast/Pick guard; destructive operations authorize actor and target; no event-store repositories exposed. Preserve status and snapshot-empty semantics; run ops server and admin REST/tRPC tests.

### P11 — Enterprise billing: request data at the tRPC edge (Luna)

**Evidence — mechanically verified.** `enterprise/modules/billing/server/src/transport/api-trpc/currency.api.ts:38-40` puts `req` in context; `79-102` constructs `CurrencyService` per router and calls it with `ctx.req`. Lint flags line `102`; billing has a direct entitlement server dependency.

**Change.** Extract typed CurrencyRequest at governed mount and pass it to one BillingApp/BillingApi instance. Replace entitlement server dependency with EntitlementApi.

**Accept / test.** Transport context is App plus policy, not raw req; currency header/geo/default ordering and SaaS empty router are unchanged. Test hosted/self-hosted/no-request; run billing+API transport checks.

### P12 — Enterprise governance private Prisma adapters (Terra)

**Evidence — mechanically verified.** `enterprise/modules/governance/server/src/repositories/prisma/prisma.department.repository.ts:13-24` exports `Pick<PrismaClient,...>`; its representative four-table queries are at `27-115`. This representative filters tenants correctly, so this is a boundary correction, not an asserted incident.

**Change.** Construct typed Prisma only in private strict adapters from GovernanceApp setup; expose only internal repository interfaces/services. Audit all organization/project predicates while moving each adapter.

**Accept / test.** No exported generated Prisma/Pick slice; cross-organization IDs cannot read/rename/archive/assign departments; P2002 recovery remains. Add adversarial tenant-isolation integration tests per table; run governance checks and `review:test-quality`.

### P13 — Prompt web closure cluster (Luna)

**Evidence — mechanically verified.** Lint reports prompt package/surface cycles and 13 boundary leaks; `modules/prompt/web/src/behavior/prompts/llm-prompt-config-utils.ts:14` imports the public prompt-form surface which re-exports drawer implementation.

**Change.** Separate controlled reusable components from screen composition; internal model/behavior may not import its own public surface barrel. Pass data/actions explicitly.

**Accept / test.** No prompt web cycle/surface closure/boundary leakage; studio editing, variables, dataset preview and streaming work in loading/empty/entitled states. Run prompt-web checks and targeted UI tests.

### P14 — Project home web closure cluster (Luna)

**Evidence — mechanically verified.** Lint reports 18 project-web screen-closure findings: `modules/project/web/src/screens/home/components/traces-overview.tsx:4-5` imports analytics surfaces; `home-page-banners.tsx:19-22` imports Langy/navigation surfaces.

**Change.** Use small named render ports in project-home composition, or move genuinely reusable widgets to their owning public surface. App UI retains routes/data hooks.

**Accept / test.** No screen-level cross-feature implementation imports; preserve home banners, briefing, trace overview and onboarding in loading/empty/entitled states. Run project-web checks and lint.

## Enforcement and hand-off matrix

“Existing rule” names an exact rule present locally, not a hoped-for guard.
“Missing” is listed only when a small deterministic AST rule can check the
stated invariant. A baseline/config gap means the rule already exists but its
allowlist/baseline or adoption state is the gap; do not add a duplicate rule.
The Luna text is deliberately the minimum self-contained assignment; it does
not authorize touching adjacent packets.

| Packet | Existing enforcement / baseline gap | Missing deterministic enforcement (only where warranted) | Minimum Luna prompt |
| --- | --- | --- | --- |
| P1 | `api-transport-through-framework`, `feature-app-contract`, `feature-app-factory`; transport allowlist is the adoption ratchet. | None: shrink the existing allowlist after conversion. | “Convert only `<reference feature>` declaration and mounts to its existing `withTransports` contribution; preserve routes and tests; delete its matching allowlist entries.” |
| P2 | `feature-app-contract`/`feature-app-factory` protect installed Apps; no rule currently describes a process composition field graph. | None: P2 is a sequence of deletions and graph construction cannot be validated safely by a name-based rule. | “Do only API audit-log nested runtime at `api-production.composition.ts:852-860`; audit-log already has an installer. Put that installer in the one API root graph and remove its second `createApp`/resource owner; do not touch other composed fields.” |
| P3 | Same App rules; `api-transport-through-framework` applies at transport edges. | None: lifecycle ordering needs integration tests, not a shallow lint. | “Do only connected-agent registration at worker lines 421-434; create named lifecycle adapter; add start/failed-start/stop test; do not change mail or feature graphs.” |
| P4 | The new `boundary-signature-mirrors` guard covers these worker assertion and signature bridges. `typed-prisma-seam` is limited to `as PrismaClient`/`database: object` in strict adapter paths; `prisma-containment` permits composition seams. | Implemented `boundary-signature-mirrors`: forbids `as unknown as`, `Parameters`, `ReturnType`, and `ConstructorParameters` in `apps/*/src/**/*.composition.ts` and feature contract/App boundary files; exclude repository implementation files. This is a directly AST-checkable rule and does not duplicate either inspected Prisma rule. | “Change only governance ingestion worker setup, remove three double casts and raw Prisma bag with typed installer setup; preserve SSRF, schedule, retries and tenant predicates.” |
| P5 | Same guard as P4. | Same `boundary-signature-mirrors` rule as P4; do not create a second rule. | “Move only scenario worker execution setup into scenario installer contribution; preserve cancellation, duplicate Redis lifetime and child cleanup.” |
| P6 | `prisma-containment` checks imports and `typed-prisma-seam` checks the existing typed seam; the exported narrowed client is a migration finding. | None: keep this as a bounded review/migration correction; do not add a duplicate substrate rule. | “Replace only WorkerObjectStorage exported Prisma/Azure bag with typed infrastructure ports; preserve BYOC, global bucket and lazy Azure behaviour.” |
| P7 | `api-transport-through-framework` rejects raw handler context; `feature-app-contract` rejects portable API service fields. | None: callback-port size/naming is too structural and would duplicate review judgment. | “Move one organization tRPC family to `ctx.app` and explicit actor/scope; do not touch auth/identity/SSO; preserve target authorization and list ordering.” |
| P8 | `package-cycle`, `ui-web-public-boundary-leakage`, `ui-surface-closure`; these are existing closure guards. | None: API verb duplication requires caller/parity evidence, not naming lint. | “Canonicalize one prompt operation pair and its transport shim only; replace its derived input with contract input; preserve REST/tRPC bytes.” |
| P9 | `feature-app-contract` covers App/API shape. | None: branded actor quality and semantic command boundaries cannot be soundly inferred from AST alone. | “Replace only gateway virtual-key command aliases and unknown actor with explicit contract values; run virtual-key scope RBAC integration test.” |
| P10 | `feature-app-contract`; `api-transport-through-framework` for raw contexts. Neither inspected rule rejects the audit signature double cast. | Reuse P4 `boundary-signature-mirrors` for the audit double cast; no new Ops-specific rule. | “Replace only Ops audit bridge cast and Pick guard with an explicit audit command/operator value; preserve admin error mapping.” |
| P11 | `api-transport-through-framework` explicitly recognizes raw `req`/context fields; `cross-feature` catches package direction. | None: convert its existing framework violation; remove the existing entitlement direct dependency. | “Change only billing currency mount to extract typed request fact and call one BillingApp method; preserve hosted/self-hosted/default currency behaviour.” |
| P12 | `prisma-containment` correctly allows strict repository imports; `typed-prisma-seam` covers the typed adapter seam. `enterprise-composition` is unrelated package-direction enforcement. | None: correct the exported `Pick<PrismaClient,...>` seam in the bounded migration; do not add another guard. | “Move only department Prisma construction behind private Governance setup; add cross-organization read/rename/archive/assign tests; keep P2002 recovery.” |
| P13 | `package-cycle`, `ui-screen-closure`, `ui-web-public-boundary-leakage`, `ui-surface-closure`. | None: existing rules report this exact cluster. | “Fix only prompt-form public-barrel back-imports; preserve controlled props and prompt studio behaviour; do not move API hooks.” |
| P14 | `ui-screen-closure` reports the exact project-home imports. | None: existing rule is sufficient. | “Replace only project-home analytics/Langy/navigation screen imports with named render ports or owning surfaces; preserve empty/loading/entitled states.” |

## Local Claude metadata check

Only directory metadata was inspected, never session payloads or secrets.
` .claude/worktrees/` names active-looking worktrees including
`identity-slice1-auth`, `identity-slice2-settings`, and `identity-slice3-sso`,
which corroborates the coordination exclusion. No readable local session
summary/status metadata was found at the inspected shallow paths; detailed
Claude session content was not read.

## Remaining universe

The 324 `boundary-signature-mirrors` findings and the remaining transport,
app-contract and Enterprise-composition findings are mechanically verified
backlog clusters, not permission for wholesale rewrites. For each new packet:
read the exact lint diagnostic, trace endpoint/worker flow, move one vertical
slice, delete displaced production code, then run focused package checks,
relevant integration tests, Oxfmt, Oxc, architecture lint,
`pnpm --filter @langwatch/architecture-enforcer review:test-quality` for changed
tests, and `git diff --check`. Report unrelated workspace failures verbatim;
never call them green.

The API/worker lookup graphs, worker governance casts, process substrate bags, organization callback ports and Ops audit cast are direct architecture-contract violations. Gateway and web closure packets are ranked heuristic candidates, chosen because they make public boundary verification unreliable.

## Structural review of the receiver correction

The first generic OTLP helper passed tests but duplicated request schemas and
handwritten interfaces and added several traversal wrappers. The extra request
schema had no production callers. It was removed instead of maintaining a second
validation path for test fixtures. Mutation preserves unknown payload fields; the
existing body parser remains unchanged for compatibility. Its JSON type assertion
is an existing runtime-validation gap, not something these policy tests fix.

The accepted shape uses a small declarative policy, a minimal structural mutation
view and one traversal with local attribute/span/metric operations. Source and
billing decisions remain in Governance; the credential adapter coordinates the
complete Governance contract. No additional class hierarchy is needed for pure
in-memory transformations.
