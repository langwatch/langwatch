# Licensing merge: entitlement and usage into enterprise licensing

Status: SUPERSEDED (Alex, 2026-10-06 late evening): usage merges into core entitlement; licensing and
billing stay separate (rulings file). Sections 1, 3 and 4 remain useful as an inventory.

Plan only, no code. Ruling: `.claude/coordinator/rulings-2026-10-05.md`, "Alex, 2026-10-06 (evening):
commerce merge replaces R4; domains withdrawn". Measured against HEAD `acf03c2bf9`, 2026-10-06.

The ruling, restated as constraints this plan must meet:

- `modules/entitlement` and `modules/usage` merge into `enterprise/modules/licensing`, one enterprise
  module owning licences, activation codes, Connect, the instance registry, plan resolution, limits,
  enforcement and metering. Core modules call it. Without a licence or Cloud subscription it answers the
  self-hosted baseline plan.
- Billing stays separate. Licensing calls billing synchronously for the Cloud subscription, the pricing
  model and billable counts. Billing stops calling licensing and entitlement; connected invoicing gets seats
  and contract terms by facts or passed in.
- Superseded: R4 (both versions), usage D1, peer cuts E1 and E2 as written. R8 stands (hosted judging
  moves to instant-eval; `licensing -> instant-eval` is cut).

Every choice the ruling does not make is listed in section 6, not taken.

---

## 1. Inventory

### 1.1 entitlement (`modules/entitlement`, core)

Halves: contract, process. No browser half. Installed by api, worker, tasks.

**`EntitlementApi`** (`contract/src/entitlement.api.ts:40`, key `"entitlement"`, 7 operations). Peer
callers, by module, file:line under `process/src/`:

| Operation                | Callers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getActivePlan`          | auth `services/api-door.service.ts:329`, `services/sign-in-security-settings.service.ts:107`; automation `services/automation-next-step.service.ts:47`, `services/persist-cap.service.ts:84`; data-retention `services/retention-plan.service.ts:42`; identity `app/identity.app.ts:658,743,885`, `services/join-request-notifier.service.ts:408`; instant-eval `app/instant-eval.app.ts:221,286,332`; organization `services/invite-creation.service.ts:125`, `services/invite-lifecycle.service.ts:202`, `services/organization-seat-license.service.ts:143`; role `services/role.service.ts:44`; trace `services/trace-visibility-window.service.ts:28`; usage `services/usage-counting.service.ts:60`; webhook `app/webhook.app.ts:222`, `services/webhook-access.service.ts:12`; governance (enterprise) `app/governance.app.ts:738`, `services/governance-plan-gate.service.ts:35`, `services/persona-home.service.ts:50`; scim (enterprise) `app/scim.app.ts:454`, `services/scim-token.service.ts:177` |
| `requestBound`           | analytics `services/langwatch-ql-bounds.service.ts:33`; annotation `app/annotation.app.ts:580,584`; dataset `services/dataset-request-bounds.service.ts:40,54,65`; experiment `services/experiment-attachment-limit.service.ts:54`, `services/experiment-execution-data.service.ts:242,243,312`; langy `services/langy-turns-bounds.service.ts:33`; organization `services/invite-creation-throttle.service.ts:50`; prompt `services/prompt-execute-bounds.service.ts:48,60`; scenario `services/scenario-generate-bounds.service.ts:33`; trace `services/trace-export-bounds.service.ts:55,77`, `services/trace-read-bounds.service.ts:48`; webhook `services/webhook-test-bounds.service.ts:28`                                                                                                                                                                                                                                                                                                              |
| `assertWithinUsageLimit` | scenario `services/scenario-event.service.ts:225`; trace `services/trace-ingest-allowance.service.ts:47`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `resolvePlanNextStep`    | automation `services/automation-next-step.service.ts:48`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `getUsage`               | no peer; served as `limits.getUsage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sendUsageLimitWarning`  | no peer; served as `limits.checkAndSendUsageLimitNotification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `listOrganizationSpend`  | no peer; served as `costs.getAggregatedCostsForOrganization`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The 19 peer modules (each declares `EntitlementApi` in `static dependencies`, app file:line): analytics
`analytics.app.ts:322`, annotation `:114`, auth `:222`, automation `:374`, data-retention `:108`, dataset
`:115`, experiment `:208`, governance `:448`, identity `:439`, instant-eval `:129`, langy `:257`,
organization `:335`, prompt `:137`, role `:58`, scenario `:232`, scim `:242`, trace `:858`, usage `:34`,
webhook `:171`. The framework does not name the token: the door's `entitlements` port is fed by auth's
`api-door.service.ts` (`packages/process/src/transport/api-surface.ts:146,160` passes it through).

Contract package `@langwatch/entitlement-contract`: 221 importing files, 186 outside the module (127 of
the 221 are tests), across 26 packages (largest: scim 22, organization/process 19, trace 19,
governance/process 16). Exports besides the token: `Plan`/`PlanInfo`/`planSchema`, `UsageStats`, plan-limit
errors, plan-gate helpers (`assertEnterprisePlan`), member classification, `EntitlementSource`/
`EntitlementGrant`/`ResolvePlanInput` (the provider port), `USAGE_UNIT_DISPLAY_LABELS`, config.
`@langwatch/enterprise-licensing-contract` itself imports it (`license.ts:1`, `licensing.api.ts:1`,
`license-plan.ts:5` re-exports `Plan as PlanInfo`, `license.service.ts:1,16`).

**Doors.** No REST. tRPC: `plan.getActivePlan` (`organization:view`), `limits.getUsage`
(`organization:view`), `limits.checkAndSendUsageLimitNotification` (`organization:manage`),
`costs.getAggregatedCostsForOrganization` (`organization:view`); contracts `contract/src/entitlement.trpc.ts:17,23,40`.
Browser readers (by procedure name): billing, governance, authz, data-retention, dataset, gateway,
navigation, organization, project, user browser halves; `organization/browser/src/organization.web.ts`
imports the tRPC contracts.

**Peers out** (`app/entitlement.app.ts:127-132`): users `findById` (`app:346,348`); license (as
`EntitlementSource.resolve`, `app:182`, `services/entitlement.service.ts:61`); billing
`getActiveSubscriptionPlan` (`services/subscription-plan.service.ts:23`), `getPricingModel` and
`countBillableEventsByProjects` (`services/usage-enforcement.service.ts:199,203`), `sendUsageWarning`
(`services/usage-warning.service.ts:96`); traces `countTracesByProjects` (`usage-enforcement:201`);
organizations `getOrganizationIdByTeamId`, `findAllIds`, `getDatasetLimits`, `getPricing`
(`usage-enforcement:197`, `usage-warning:49`, `app:245,275`); projects `listIdsByOrganization`
(`usage-enforcement:198`, `usage-warning:40`).

**Events.** Publishes none. Subscribes to none. Pipeline `entitlement_usage_warning` (aggregate
`global`), process manager `entitlementUsageWarningSweep` daily, intent `sweep`
(`eventing/entitlement-usage-warning.pipeline.ts:31,36`).

**Tables.** Claims none. Reads Postgres `Cost`, `Organization`, `OrganizationUser`, `Project`, `Team`,
`TeamUser`, `User` (`repositories/prisma/*`; not flagged by `prisma-table-ownership` today).

**Config.** `requestBounds` (`LANGWATCH_REQUEST_BOUNDS`), `isSaas` (`IS_SAAS`),
`contract/src/entitlement.config.ts:20,22`. No secrets. No tasks, no migrations.

**Specs** (all fully bound, `check:feature-parity` 2026-10-06): dataset-bounds-override 6/6,
enterprise-plan-refusal 2/2, entitlement-resolution 12/12, organization-spend 3/3, plan-next-step 14/14,
usage-limit-refusal 2/2, usage-stats-reporting 4/4, usage-warning-sweep 6/6. ADR
`adrs/001-provider-neutral-plan-resolution.md`.

### 1.2 usage (`modules/usage`, core)

Halves: contract, process. Installed by api, worker, tasks.

**`UsageApi`** (`contract/src/usage.events.ts:59`, key `"usage"`, 0 operations). No peer declares it.

**Peers out** (`app/usage.app.ts:34-36`): entitlement `getActivePlan` (`services/usage-counting.service.ts:60`);
billing `getPricingModel` (`usage-counting:61`); projects `findOrganizationId`
(`eventing/usage-meter-count.subscriber.ts:33`, `services/trace-meter-append.service.ts:34`,
`services/billable-events-meter-append.service.ts:34`).

**Events.** Pipeline `usage`, aggregate `usage_organization` (`eventing/usage.pipeline.ts:67`). Publishes
`lw.usage.month_counted`, `lw.usage.limit_reached`, `lw.usage.limit_cleared` (`contract/src/usage.events.ts:8-10`).
Commands `countMonth` (5 min delay, dedup by organization and month), `recordLimitDecision`. Process manager
`refusedOrganizations`. Global map projections `orgBillableEventsMeter` (many event types) and
`usageTraceMeter` (span received); both names are frozen halves of routing keys
(`eventing/billable-events-meter.projection.ts:17`, `eventing/trace-meter.projection.ts:7`).
Subscribers elsewhere: billing `usageMonthCounted` (`billing-reporting.pipeline.ts:93`) and
`usageLimitReached` (`billing-lifecycle.pipeline.ts:73`, `eventing/plan-limit-reached.subscriber.ts`).

**Tables.** ClickHouse `billable_events` and `usage_trace_meter` (writes); migrations are central
(`packages/clickhouse-migrations/migrations/00104_create_usage_trace_meter.sql`). Billing reads
`billable_events` (`clickhouse.billable-events.repository.ts:31`), the one `clickhouse-table-ownership`
finding for these modules.

**Config.** `isSaas` (`contract/src/usage.events.ts:63`). No doors, tasks or migrations.
`services/trace-meter-seed.service.ts` exists but is not wired (Q14's `.withMigrations` step has not landed).

**Specs:** usage-counting 6/6, usage 25/25. ADR `adrs/001-usage-package-boundary.md`.
`@langwatch/usage-contract`: 15 importing files, 4 outside (billing process 3, usage contract).

### 1.3 licensing (`enterprise/modules/licensing`)

Halves: contract, process, browser. Installed by api, worker, tasks; ui.

**`LicensingApi`** (`contract/src/licensing.api.ts:285`, 57 operations). Peer callers:

| Caller         | Operations, file:line under `process/src/`                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entitlement    | `resolve` (as plan source, `services/entitlement.service.ts:61`)                                                                                                                                                                                      |
| auth           | `isPlatformSsoLicensed` (`app/auth.app.ts:525,586`, `app/auth-composition.build.ts:153`)                                                                                                                                                              |
| identity       | `isPlatformSsoLicensed` (`app/identity.app.ts:529,655`); `getDomainClaimAuthority` (`services/sso-connection-guard-checks.service.ts:196`, `services/sso-domain-ceremony.service.ts:231`)                                                             |
| instant-eval   | `classifyThroughConnect`, `isConnectServiceEnabled` (`services/instant-eval-connect-judge.service.ts:65,86`)                                                                                                                                          |
| ops            | `getLicenseStatus`, `getConnectStatus`, `getConnectDeployment`, `findInstanceIdentity` (`services/ops-checkup.service.ts:209-225`); `getInstanceId`, `recordUsageReportOutcome`, `setUsageReportSwitches` (`services/usage-report.service.ts:75-182`) |
| sso            | `inspectPlatformAccess` (`services/sso-gate.service.ts:204`, `services/sso-self-serve-context.service.ts:73`), `licenseRevision` (`sso-gate:164`), `getDomainClaimAuthority` (`sso-self-serve-context:41`)                                            |
| saas           | `recordUsageReport` (`services/usage-report-receiver.service.ts:100`)                                                                                                                                                                                 |
| enterprise-ops | the issued-licence registry and activation codes through `services/license-registry-audit.service.ts:61-250` and `app/enterprise-ops.app.ts:96,101`                                                                                                   |
| billing        | 9 operations, section 3.1                                                                                                                                                                                                                             |

`getActivePlan(organizationId: string)`, `getSelfHostedPlan` and `resolve` have no caller outside licensing
except entitlement's `resolve`. `getActivePlan` collides by name, with a different signature, with
`EntitlementApi.getActivePlan(input)`.

**Doors.** REST `connectHostRest` (`POST /api/connect/v1/license/sync`, `/activate`, credential project,
public) and `connectHostedRest` (`POST /api/internal/gateway/connect/{instant-evals-classify,usage,budget}`,
internal secret). tRPC `connect.{status,setService,setCap}`, `license.{getStatus,getSsoGateStatus,upload,
activate,remove,refresh}`.

**Peers out** (`app/licensing.app.ts:165-171`): gateway (budgets, managed keys, Connect upstream slot,
internal door: `contract-budget-store.service.ts:30-102`, `hosted-usage-reader.service.ts:37-47`,
`app:894-902,1028-1029`, `licensing.module.ts:19`); organizations (`countMemberSeats` `app:127,129`,
`findById`, `findAllIds`, `findLicensedOrganizationIds`, `recordSyncOutcome`, `setServicesDisabled`,
`markSelfHostedCustomer`, `createSelfHostedCustomer`, `findProvisioningSummary`, `findAllOldestFirst`);
instantEval `classify`, `priceOf`, `recordSpendForHostedCalls` (`app:943-946`, R8 cut pending); projects
`findById` (`hosted-usage-reader:36`).

**Events.** Pipeline `license_sync` (process manager `licenseSync`, every 2 min; peer subscriber
`configuredLicenseOnSignUp` on `lw.organization.signed_up`). Publishes no fact today (the seat-raised
event of record §9 is not in the tree yet).

**Tables.** Postgres `ActivationCode`, `InstanceIdentity`, `IssuedLicense`, `SelfHostedInstance`,
`SelfHostedInstanceReport`, plus `Organization` licence columns (accessed, not claimed). Stores prisma,
encryption, rateLimiter.

**Config and secrets.** Secrets `instanceLicenseKey`, `licensePrivateKey` (`app/licensing.app.ts:179-180`).
Config `publicKey`, `connectDisabled`, `connectGatewayEndpoint`, `connectLicenseEndpoint`,
`connectInstanceId`, `isSaas`, `serviceVersion`, `otelResourceAttributes`, `outboundProxy`
(`contract/src/licensing.config.ts:45-75`). No tasks, no migrations.

**Browser half** `@langwatch/enterprise-licensing-browser`, one export `./declaration`
(`src/licensing.web.ts`): licence status and upload, Connect settings, the shell's global upgrade modal
(imports `SeatProrationPreviewToken` from billing's contract). Imported by `apps/ui` only.

**Specs:** licensing.feature 26/26 bound. ADR `adrs/001-licensing-package-boundary.md`.

### 1.4 billing's edges into the three

- Peer: `licensing: LicensingApi` (`process/src/app/billing.app.ts:195`). No peer on entitlement or usage.
- Contract types: billing contract imports `PlanInfo` from licensing contract (`billing-types.ts:1`,
  `plan-limits.ts:1`, `billing.api.ts:3`); `getActiveSubscriptionPlan` returns it.
- Process imports: `LIMIT_TYPE_DISPLAY_LABELS` (`resource-limit-alert.service.ts:7`),
  `USAGE_UNIT_DISPLAY_LABELS` (`plan-limit-alert.service.ts:7`), usage event schemas
  (`plan-limit-reached.subscriber.ts:7`, `billing-reporting.pipeline.ts:17`), and `EntitlementSource`,
  `applyPlanTypeEntitlements` in `deployment-plan-sources.service.ts`, exported as
  `createDeploymentPlanSources` (`billing.module.ts:95`) with no importer anywhere in the tree (bound by
  `specs/deployment-plan-sources.feature`, 6/6).
- Browser: billing browser imports `PlanInfo`, `MemberType`, `LicenseStatus`, `CONTACT_SALES_URL`,
  `UNLIMITED_PLAN`, `LIMIT_TYPE_DISPLAY_LABELS` from licensing contract and `Plan`, `UsageStats` from
  entitlement contract; reads `plan.getActivePlan` and `limits.getUsage`.
- Billing serves entitlement and usage: `getActiveSubscriptionPlan`, `countBillableEventsByProjects`,
  `sendUsageWarning`, `getPricingModel` (`BillingApi`, `contract/src/billing.api.ts:103`).

---

## 2. The merged module's shape

Everything below follows record §3 (four packages), §3.1 (one contract, `*Api` token), §11 (enterprise
mirrors module shape, installs like any other) and in-tree precedents named per line. Where a choice
exists, options are listed and left to section 6.

### 2.1 Packages

| Half     | Package after the merge                    | Absorbs                                                        |
| -------- | ------------------------------------------ | -------------------------------------------------------------- |
| contract | `@langwatch/enterprise-licensing-contract` | `@langwatch/entitlement-contract`, `@langwatch/usage-contract` |
| process  | `@langwatch/enterprise-licensing-process`  | `@langwatch/entitlement-process`, `@langwatch/usage-process`   |
| browser  | `@langwatch/enterprise-licensing-browser`  | nothing (neither has a browser half)                           |

Whether the two absorbed contract package names survive one release as re-export packages is Q2.

### 2.2 Contract

Operations, grouped by concern (files keep their names, moved under `contract/src/`):

- **Plan and limits** (today's `EntitlementApi`): `getActivePlan`, `requestBound`, `assertWithinUsageLimit`,
  `resolvePlanNextStep`, `getUsage`, `sendUsageLimitWarning`, `listOrganizationSpend`.
- **Licences**: `validateAndStoreLicense`, `getLicenseStatus`, `removeLicense`, `uploadLicense`,
  `licenseRevision`, `refreshLicense`, `syncLicenses`, `inspectPlatformAccess`, `getSsoGateStatus`,
  `isPlatformSsoLicensed`, `getDomainClaimAuthority`.
- **Issued-licence registry and activation codes**: `issueLicense`, `generateLicenseKey`,
  `recordIssuedLicense`, `registerLegacyLicense`, `revokeIssuedLicense`, `reissueLicense`,
  `changeLicenseSeats`, `resetLicenseInstanceBinding`, `updateLicenseTerms`, `linkLicenseToOrganization`,
  `getIssuedLicense`, `listIssuedLicenses`, the four activation-code operations.
- **Connect and the instance registry**: the Connect, hosted-service, instance and usage-report operations.
- **Connected contract terms**: `getContractTerms`, `getConnectedSeats`, `findSeatChanges`,
  `raiseContractCommit`, `syncContractBudget`, `resetContractBudget` (fate per section 3).
- **Metering**: no operation; events `lw.usage.{month_counted,limit_reached,limit_cleared}` and their schemas.

Leaving the contract (no outside caller once merged): `LicensingApi.resolve`, `getActivePlan(organizationId)`,
`getSelfHostedPlan`. Removing the old `getActivePlan` is what frees the name for the plan read.

Tokens (Q1): either `EntitlementApi` stays as a second token keyed `"licensing"` (precedent: identity's
contract declares `IdentityApi`, `IdentityLookupApi`, `TwoStepVerificationApi`, all keyed `"identity"`,
`identity.api.ts:825`, `identity-lookup.ts:241`, `two-step-verification.ts:118`; one class implementing
several tokens: `BillingModule`, `billing.app.ts:184`), or the seven operations join `LicensingApi`.
`UsageApi` (0 operations) has nothing to keep (Q3).

Config: one `licensingConfig` adds `requestBounds`; the three `isSaas` leaves become one.

### 2.3 Process

- `LicensingModule` (`app/licensing.app.ts`, 1,153 lines today) absorbs `EntitlementModule` (359) and
  `UsageModule` (92). Composition stays in `create`; entitlement's and usage's services, rules,
  repositories and eventing move file for file under `process/src/{services,rules,repositories,eventing}`.
  The `service-ceilings` policy may refuse the combined class; splitting it is the module's own business.
- Repositories: licensing's registry gains entitlement's prisma pair (organization spend, usage membership)
  and usage's ClickHouse pair (billable-events meter, trace meter). Stores required: prisma, encryption,
  rateLimiter, clickhouse.
- Pipelines (three, billing's precedent at `billing.module.ts:42`): `license_sync`,
  `entitlement_usage_warning`, `usage`. Pipeline names, aggregate types, event types, process-manager names
  and projection names stay byte for byte: they are stored or are halves of routing keys.
- Transports: `licenseTrpcTransport`, `connectTrpcTransport`, `connectHostedRest`, `connectHostRest`, plus
  `planTrpcTransport`, `usageLimitsTrpcTransport`, `organizationSpendTrpcTransport`. Procedure names
  (`plan.*`, `limits.*`, `costs.*`) unchanged.
- Peers after the merge (before section 3's cuts): billing, gateway, instant-eval (R8 cut pending),
  organization, project, trace, user.
- Tasks and migrations: none today. Q14's trace-meter seed, when it lands, is a licensing `.withMigrations` step.

### 2.4 Browser

Unchanged. The organization and billing browser halves repoint their type imports
(`organization/browser` 4 files, `billing/browser` 2 files) to the licensing contract.

### 2.5 Specs, ADRs, catalogue

- Specs move to `enterprise/modules/licensing/specs/` with their file names (bindings match by title,
  `dev/docs/TESTING_PHILOSOPHY.md` "Binding scenarios to tests"; the `@see` paths in test docblocks are
  rewritten in the same slice). Expect 11 files, 106 scenarios (49 entitlement, 31 usage, 26 licensing), all bound.
- ADRs: three `001-*` files collide; renumber entitlement's and usage's as `002`, `003` with a one-line
  note in each (Q15).
- `modules/catalogue.json`: licensing's subjects gain `entitlement` and `usage`; the `entitlement` and
  `usage` entries go. Then `pnpm generate:modules`, `pnpm sync:references`, `pnpm generate:readmes`.

---

## 3. The billing direction

### 3.1 Billing's calls into licensing today, and how each goes

| #   | Operation             | Call sites (billing `process/src/`)                                                                                                                               | What billing uses it for                                  | Ways it can go (choice in section 6)                                                                                                                                                     |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `findSeatChanges`     | `services/connected-billing-overview.service.ts:57`, `services/connected-seat-change.service.ts:57` (minute poll, `seatInvoicing`)                                | invoicing seat changes                                    | Fact. Already ruled (record §9, Alex 2026-09-29): billing subscribes to licensing's seat-raised event and sends its own invoicing command; the operation and the poll go. Not built yet. |
| 2   | `getConnectedSeats`   | `connected-billing-overview.service.ts:49`, `services/connected-customer-facts.service.ts:96,106`                                                                 | statement seats; the managed key id for the spend read    | Fact (licensing records seats and managed key on change; billing folds them into its connected-account rows) or passed in (see 3 and 5).                                                 |
| 3   | `getContractTerms`    | `app/billing.app.ts:454`, `connected-billing-overview.service.ts:48`, `connected-customer-facts.service.ts:123`, `services/connected-usage-ceiling.service.ts:38` | commit, maximum, term dates for statements, ceiling, tick | Fact (terms-changed fact folded by billing), or the terms move to billing's `ConnectedBillingAccount` with licensing reading them back (data move), Q10.                                 |
| 4   | `raiseContractCommit` | `app/billing.app.ts:456`                                                                                                                                          | billing's tick raises the commit on the licence           | Billing records a fact licensing subscribes to (eventual), or the commit leaves the licence for billing (data move), Q10.                                                                |
| 5   | `syncContractBudget`  | `app/billing.app.ts:458`                                                                                                                                          | mirrors the contract budget into the gateway              | As 4. Note licensing already writes the gateway budget itself (`contract-budget-store.service.ts`).                                                                                      |
| 6   | `resetContractBudget` | `app/billing.app.ts:459`                                                                                                                                          | resets the budget at renewal                              | As 4.                                                                                                                                                                                    |
| 7   | `getHostedUsage`      | `connected-customer-facts.service.ts:110`                                                                                                                         | contract spend for the statement                          | Billing reads the gateway itself (it already peers gateway; duplicates licensing's budget rules) or licensing records a hosted-spend fact, Q11.                                          |
| 8   | `generateLicenseKey`  | `services/licensing-license-generator.service.ts:25` (wired `billing.app.ts:232`)                                                                                 | Stripe licence purchase: sign a key                       | Billing's existing `lw.billing.checkout_completed` fact (`billing-lifecycle.pipeline.ts:68`) carries the purchase; licensing subscribes, signs and records; who mails the key is Q9.     |
| 9   | `recordIssuedLicense` | `services/license-purchase-delivery.service.ts:37` (wired `billing.app.ts:235`)                                                                                   | record the purchased licence                              | Same fact as 8.                                                                                                                                                                          |

Also to remove from billing: the `licensing` peer (`billing.app.ts:195`); `createDeploymentPlanSources`
and its service (dead; Q16); value imports `LIMIT_TYPE_DISPLAY_LABELS`, `USAGE_UNIT_DISPLAY_LABELS` stay
legal (contract imports are not peer edges) but keep billing's packages depending on licensing's contract.
`PlanInfo` in billing's contract is Q8.

Billing's peer subscribers on usage's facts (`usageMonthCounted`, `usageLimitReached`) stay; they become
subscriptions to licensing's facts with the same event types. A subscriber is not a call (record §9).

### 3.2 Calls the merged module makes into billing

| Operation                       | Today's caller                                                                                | Ruling                                | Note                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getActiveSubscriptionPlan`     | entitlement `services/subscription-plan.service.ts:23` (Cloud only, `entitlement.app.ts:177`) | Cloud subscription: stays synchronous | Return type `PlanInfo` is licensing's type (Q8).                                                                                                            |
| `getPricingModel`               | entitlement `usage-enforcement.service.ts:199`; usage `usage-counting.service.ts:61`          | pricing model: stays synchronous      | Overlaps `OrganizationApi.getPricing` (Q161 currency ruling), which entitlement already reads at `entitlement.app.ts:275`. Two sources for one column: Q13. |
| `countBillableEventsByProjects` | entitlement `usage-enforcement.service.ts:203`                                                | "billable counts": stays synchronous  | Billing answers it from `billable_events`, which usage writes and the record gives to usage (§11, "billing counts nothing"). Conflict: Q5.                  |
| `sendUsageWarning`              | entitlement `usage-warning.service.ts:96`                                                     | not named by the ruling               | Record §11 says usage records the crossed threshold as a fact and billing sends. Keep the call (ruled direction) or the fact: Q12.                          |
| `notifyResourceLimitReached`    | nobody in the three (organization's seat event reaches billing by subscriber)                 | n/a                                   | Unchanged.                                                                                                                                                  |

---

## 4. Peer-cycle effect

Measured with the enforcer's own reader (`peerEdges` from
`packages/architecture-enforcer/src/policies/boundaries/peer-cycles.ts`), then contracted (entitlement and
usage renamed to licensing, self-loops dropped). `pnpm lint:architecture --policies peer-cycles` reports
the same count (25 shown + 220 hidden).

| Model                                                                               | Edges | Findings | Modules in cycles | Findings touching licensing/billing      |
| ----------------------------------------------------------------------------------- | ----- | -------- | ----------------- | ---------------------------------------- |
| Today                                                                               | 402   | 245      | 40                | 35 (entitlement/usage/licensing/billing) |
| Merge only, every edge kept                                                         | 393   | 239      | 39                | n/a                                      |
| Merge, billing -> licensing cut                                                     | 392   | 238      | 39                | n/a                                      |
| Merge, billing cut, R8 `licensing -> instant-eval` cut (the ruled end state)        | 391   | 237      | 39                | 27                                       |
| Ruled, plus billing drops data-retention, organization, project, gateway, audit-log |       | 231      |                   |                                          |
| As above, plus licensing keeps only `-> billing`                                    |       | 209      |                   | 0                                        |

What the ruled end state still leaves in a cycle:

- **`licensing -> billing` stays cyclic** while billing depends on any module that calls licensing.
  Back paths: `billing -> data-retention -> licensing`, `billing -> organization -> licensing`,
  `billing -> project -> organization -> licensing`, `billing -> gateway -> organization -> licensing`,
  `billing -> audit-log -> annotation -> licensing`. Data-retention and organization call plan resolution
  directly, so under "core calls licensing" these back edges cannot be cut on their side. Only billing's
  edges to authz and notification are acyclic. Cutting billing's edges to data-retention, organization and
  project still leaves the audit-log path (234); adding gateway leaves it too (233); with audit-log as well,
  `licensing -> billing` is clear (231). Q6.
- **Licensing's other out-edges**, each still cyclic, each worth 1 finding alone: `-> organization`
  (back `organization -> licensing`), `-> project` (`project -> organization -> licensing`), `-> trace`
  (`trace -> licensing`), `-> user` (`user -> auth -> licensing`), `-> gateway`
  (`gateway -> organization -> licensing`). They came from entitlement (E2's targets, superseded "as
  written") and from licensing itself (gateway, organization, project). Q7.
- **Callers into licensing that are cyclic** in the ruled state: analytics, annotation, auth,
  data-retention, dataset, experiment, governance, identity, instant-eval, organization, prompt, role,
  scenario, scim, sso, trace. They clear by themselves once licensing's out-edges are cut; none needs
  cutting on the caller's side.
- With licensing keeping only `-> billing` and billing keeping only authz and notification, licensing and
  billing leave the component entirely: 245 to 209, no finding touches either.

Batch plan effect: `peer-cycle-cuts-2026-10-06.md` lanes E1, E2 and LI (B1, B2) are replaced by this plan;
batch T's `entitlement -> trace` cut becomes `licensing -> trace`.

---

## 5. Slices

Each slice leaves the tree booting and its touched packages green (`pnpm --filter <pkg> typecheck`, scoped
oxlint, the module's tests, `check:feature-parity` unchanged). Shared files (catalogue, generated module
lists, tsconfig references, `ARCHITECTURE.md`, baselines) are coordinator applies, requested in each
lane's handoff. Order: L0, L1, L2, L3; L4 to L7 after the section-6 answers they need.

**L0. Clear the name collision inside licensing.** Owned: `enterprise/modules/licensing/{contract,process}/src`.
Drop `getActivePlan(organizationId)` and `getSelfHostedPlan` from `LicensingApi` (no outside caller; the
service keeps them). `resolve` stays until L1 (entitlement still calls it). Binds: licensing.feature as
today. Wire: none. Deploy: none.

**L1. Entitlement into licensing.** Owned: `modules/entitlement/**` (deleted), `enterprise/modules/licensing/**`,
the import lines and `package.json` dependencies of the 26 importing packages (a mechanical rewrite), test
docblock `@see` paths. Moves contract and process together (a token must live with its implementing
module). `LicensingModule` implements the plan operations under Q1's answer; `resolve` leaves the
contract; config gains `requestBounds`. Shared requests: `modules/catalogue.json`, generated module lists,
tsconfig references, readmes, record §11 and §3.3 table wording. Binds: the eight entitlement features
(moved). Peer edges: `entitlement -> licensing` disappears; licensing gains billing, trace, user.
Wire: none (procedure names, permissions and errors unchanged). Deploy: none beyond the module id
`entitlement` leaving the module lists; confirm no queue or outbox key carries a module id (the
pipeline name `entitlement_usage_warning` stays). Size: about 220 files touched, most a one-line import
rewrite; if Q2 keeps a re-export package, L1 shrinks to the move and the repoint becomes L1b.

**L2. Usage into licensing.** Owned: `modules/usage/**` (deleted), licensing, billing's 2 event-schema
import lines. Pipeline `usage`, aggregate `usage_organization`, `lw.usage.*` event types and both
projection names unchanged. Repositories gain clickhouse. Binds: usage-counting, usage (moved). Edges:
`usage -> *` disappear (already contracted). Wire: none. Deploy: none if the pipeline name is unchanged;
the worker must not see the `usage` pipeline registered twice during a rolling deploy (old worker, module
`usage`; new worker, module `licensing`, same pipeline name): verify the eventing registry keys by
pipeline name only.

**L3. Seat changes by fact** (ruled already, record §9). Owned: licensing (a seat-raised fact from
`changeLicenseSeats` and the Connect seat sync), billing (`seatInvoicing` poll replaced by a peer
subscriber; `ConnectedSeatChangeService` reads its own rows). Removes call 1. Binds: billing.feature
seat scenarios, licensing seat scenarios; write the scenario for the fact first. Wire: none. Deploy:
in-flight unpaid seat changes need a one-shot catch-up (a licensing background step re-records
undecided changes): data step, migration skill.

**L4. Connected terms and budget** (after Q10, Q11). Owned: billing connected-billing services and
pipeline, licensing contract-terms services. Removes calls 2 to 7. Binds: billing.feature connected
scenarios, billing-reporting-composition. Wire: none. Deploy: if terms move, an expand/contract Postgres
migration (postgres-migration skill).

**L5. Licence purchase** (after Q9). Owned: billing Stripe webhook composition, licensing registry.
Removes calls 8, 9. Binds: stripe-webhook.feature licence-purchase scenarios. Wire: none (Stripe webhook
path unchanged). Deploy: a purchase in flight across the deploy is delivered once (idempotency key on the
checkout id).

**L6. Billing drops the licensing peer.** Owned: `enterprise/modules/billing/process/src/app/billing.app.ts`,
`billing.module.ts`, `index.ts`, `deployment-plan-sources.*` (per Q16), billing contract types (per Q8).
Precondition: L3 to L5. Peer-cycle count drops by 1 (238 to 237 with R8). Wire: none.

**L7. Licensing into billing, settled** (after Q5, Q12, Q13). Owned: licensing's usage-enforcement,
usage-warning and counting services; billing's billable-events query (per Q5). Completes ruled Q73 (one
counter) if Q13 says so. Wire: none. Deploy: none, or the table-ownership move per Q5.

**L8. Licensing's remaining out-edges** (after Q6, Q7). One lane per edge family; patterns per record §5
(peer subscriber from the reactor's side, or a value passed in).

Record and docs (coordinator, alongside L1/L2): §11 "Entitlement depends on the installed `LicensingApi`
peer" and "Licensing cannot depend on entitlement" are false after L1; §3.3's capability table names
`EntitlementApi` as owner (true only under Q1 option A); §11's usage paragraph names `modules/usage`;
§9's seat-change line stands. `peer-cycle-cuts-2026-10-06.md` §4 E1, E2, LI and §8 R4 marked superseded.

---

## 6. Questions for Alex

1. **The `EntitlementApi` token.** (a) Keep it as a second token keyed `"licensing"`, implemented by
   `LicensingModule` (identity's three tokens are the precedent); the 19 callers change only an import
   path. (b) Fold the seven operations into `LicensingApi` in one change; 19 modules rename a peer type and
   47 call sites keep their method names. (c) (a) now, (b) one release later. (a) keeps record §3.3's
   wording; (b) makes the merged contract one capability of 61 operations.
2. **The absorbed contract package names.** Delete `@langwatch/entitlement-contract` and
   `@langwatch/usage-contract` in the move (about 190 files rewritten in L1/L2), or keep them one release as
   re-export packages so L1 is a pure move. A re-export package is a new pattern; the tree has none.
3. **`UsageApi` and the `lw.usage.*` names.** Drop the empty token (nothing declares it). Keep event types
   `lw.usage.*`, pipeline `usage` and the projection names as stored names (no data change), or rename to
   `lw.licensing.*` with an upcast or replay (data change, no benefit beyond naming). Plan assumes keep.
4. **Name collision.** Remove `LicensingApi.getActivePlan(organizationId)`, `getSelfHostedPlan` and
   `resolve` from the contract (no outside caller) so the plan read keeps the name `getActivePlan`. Yes or no.
5. **Billable counts.** The ruling has licensing call billing for billable counts; record §11 has usage
   own all counting and billing count nothing; `clickhouse-table-ownership` flags billing reading
   `billable_events`. (a) Licensing owns `billable_events` and counts itself; billing learns totals from
   `month_counted` (today's path) and `countBillableEventsByProjects` goes. (b) Billing owns the table and
   the read; licensing's meter projection writes through a billing operation or fact. (c) Keep both
   (policy stays red).
6. **The `licensing -> billing` cycle.** It stays cyclic while billing peers data-retention, organization,
   project, gateway or audit-log (section 4). (a) Billing drops those five edges (retention reset, profile,
   invites and pricing, project names, spend ledger, backoffice audit) by facts or values passed in. (b)
   Accept the cycle for this edge. (c) Licensing reads billing by billing's facts instead of calls (reverses
   the ruled direction).
7. **Licensing's other out-edges** (organization, project, trace, user, gateway). E2 is superseded "as
   written". Are they cut in this drive, and by which pattern: organization pushes seat counts and pricing
   as facts licensing folds; trace counts arrive with the ingest call (batch T's pattern); user's
   operator lookup passed in by the door; gateway budget and managed-key writes become licensing facts
   gateway subscribes to?
8. **Who owns the `Plan` shape.** Billing's contract returns licensing's `PlanInfo`. (a) Keep the
   type-only import (billing contract depends on licensing contract while licensing calls billing). (b)
   Billing returns its own subscription-plan schema; licensing maps it. (c) `Plan` moves to
   `@langwatch/plans` (framework package already holding the catalogue).
9. **Licence purchase.** Billing signs and records via licensing today. (a) Licensing subscribes to
   `lw.billing.checkout_completed` and signs, records and mails. (b) Licensing signs and records; billing
   keeps the mail on a licensing fact. (c) The purchase door moves to licensing.
10. **Contract commit and budget commands** (`raiseContractCommit`, `sync`, `reset`). (a) Billing records
    facts, licensing subscribes (eventual). (b) The commit and budget leave the licence and live in
    billing's connected account (data move; licensing reads them back). (c) Licensing's tick drives
    renewal and calls billing to invoice (moves the tick).
11. **Hosted spend on statements.** (a) Billing reads the gateway itself (existing peer). (b) Licensing
    records a hosted-spend fact billing folds.
12. **Usage warnings.** Keep `sendUsageWarning` as a synchronous licensing -> billing call (fits the
    ruled direction) or move to record §11's fact. Today both paths exist (the sweep calls; the
    plan-limit alert subscribes).
13. **One counter and one pricing source.** Entitlement counts through billing and trace; usage counts
    from its meters (Q73 ruled the move to usage). Does L7 finish Q73 so licensing has one counter? And
    pricing: `BillingApi.getPricingModel` or `OrganizationApi.getPricing` (both read the same column)?
14. **Source licence.** Plan resolution, request bounds and metering move under `enterprise/LICENSE.md`
    with the SPDX directive. Confirm (self-hosted open-source installs then run enterprise code for their
    baseline plan; the 2026-10-05 Q17 ruling already refuses boot without licensing).
15. **ADR numbering.** Renumber the absorbed `001` ADRs as `002` and `003`. Default unless told otherwise.
16. **`createDeploymentPlanSources`.** Unused export implementing entitlement's port inside billing,
    with a bound spec (6 scenarios). Delete it with `deployment-plan-sources.feature`, or move it into
    licensing as the Cloud plan leg.
