# ADR-139: Connected self-hosted, hosted services metered against the license

**Date:** 2026-09-19

**Status:** Accepted

**Builds on:**
[ADR-045](045-domain-errors-handled-boundary.md): every refusal below is a
`HandledError` or an `herr` code with a stable code and customer copy.
[ADR-137](137-instant-eval-run-is-a-judgment-job.md): the classifier interface
and the `InstantEvalSpendRecorder` port are that ADR's, reused unchanged in
shape.

**Behavioural contract:**
[license-registry](../../../specs/self-hosting/connected-services/license-registry.feature),
[license-credential](../../../specs/self-hosting/connected-services/license-credential.feature),
[hosted-services](../../../specs/self-hosting/connected-services/hosted-services.feature),
[connect-settings](../../../specs/self-hosting/connected-services/connect-settings.feature),
[license-sync](../../../specs/self-hosting/connected-services/license-sync.feature),
[connected-billing](../../../specs/self-hosting/connected-services/connected-billing.feature),
[managed-models-provider](../../../specs/self-hosting/connected-services/managed-models-provider.feature).

## Context

Self-hosted LangWatch is sold as an annual seat license and documented as
air-gapped. Two products need a LangWatch-hosted backend: Instant Evals, whose
judge model needs GPUs a customer should not have to run, and managed models in
the gateway. A regulated customer should be able to open one outbound door, buy
the usage through the contract they already have, see what they spend and never
be invoiced past a cap they agreed.

What the code had when this was written:

- A license is base64 JSON `{data, signature}`, RSA-SHA256, verified offline
  against an embedded public key. It carries no organization id and no instance
  id. There was no record of issued licenses.
- Any organization admin on any deployment could post a private key to
  `license.generate`. That mutation bypassed `licenseGenerationService`, so its
  validation had drifted from the service.
- The daily statistics post identified an install as
  `<organization name>__<organization id>`: one id per organization, changing on
  rename, and carrying the organization name.
- The gateway spend spine, organization budgets with a 402, managed virtual
  keys and the Instant Evals spend recorder already existed.

## Decisions taken by the founder (not reopened here)

1. The license is the credential: `Authorization: Bearer lwl_<sha256 hex>` plus
   `X-LangWatch-Instance`. The license format does not change.
2. Two hosts split by data: `gateway.langwatch.ai` carries hosted services,
   `connect.langwatch.ai` carries license sync and the optional statistics post.
3. Hard stop when the prepaid commit is spent. On-demand overage only when the
   contract enables it, with a maximum.
4. Overage invoiced quarterly in arrears. No air-gapped rate change.
5. Opt-in per hosted service in Settings, default off, stating what leaves.

## Decisions

### 1. A license registry on LangWatch Cloud

`IssuedLicense` records every license: customer organization, plan, seats,
term, status, entitled services, seat overage allowance, seat rate, commit,
overage switch and maximum, instance binding, the managed key, who issued it and
what it replaces. Status `expired` is derived from the term, never written.

Every issue path writes it through one service: the backoffice, the purchase
webhook and `scripts/generate-license.ts`. The signing key is read from
`LANGWATCH_LICENSE_PRIVATE_KEY`. `license.generate` and its form are removed;
issuing is an operator action in the backoffice.

A license issued before the registry existed is registered by pasting it. The
signature is verified, and the seats and term are read from the license itself.

The customer organization is marked `selfHostedCustomer`. Hosted usage, budgets,
credits and invoices attach to it through the models that already exist.

### 2. What the registry stores

The token is `lwl_` plus the SHA-256 of the canonical license, which is
`JSON.stringify` of the parsed `{data, signature}`. Validity is already judged
on the re-serialized payload, so hashing the same form means line wrapping or a
trailing newline in a pasted license can not split an install from its row.

The registry never stores the bearer value. It stores `sha256(token)`, a second
hash, and looks a presented token up by it, so read access to the registry is
not credential access. The token has 256 bits of entropy, so the second hash can
not be reversed and a pepper would add nothing. Leaving the pepper out also
means the issue script needs no extra secret, and an operator can compute a
lookup by hand from a license.

The one license text the registry holds is a reissued license waiting for
delivery over sync. It is encrypted at rest and erased when the install first
presents it. `ORGANIZATION_SAFE_SELECT` no longer returns `Organization.license`
to the backoffice, because license text is now credential material.

### 3. One managed key per license

Each license resolves to its own virtual key with `purpose: CONNECT`, created
the first time the license resolves. Spend rows name a virtual key and nothing
else, so a key per organization would make two installs of one customer
indistinguishable in a usage dispute.

The key is scoped to the customer organization, and its spend lands on the
organization's hidden governance project. That project is already the home of
organization-scoped keys and is already filtered out of every customer-facing
project list. A dedicated project kind was considered and dropped: more than
twenty queries filter on `kind != internal_governance`, and a second hidden kind
would have to be added to each. A customer organization created from the
backoffice has no team, so one is created when the key is.

The key's secret is discarded when it is minted. The license token is the
credential, so the key can only be reached through the registry. It is hidden
from customer-facing reads and refuses customer-facing mutations, like the
Langy key. It reaches none of the customer organization's own model providers:
hosted services run on LangWatch's providers, and a license token must not spend
a customer's provider credentials.

Revoking a license ends its key first and then marks the row. If the second
step fails, the license reads as active with a dead key, which resolves to a
refusal, and revoking again completes it. The other order could leave a revoked
license whose cached credential no gateway was told to drop. The gateway's
existing change feed evicts the cached credential. No new revocation channel is
built. Resetting the instance binding writes a change for the key as well,
because a gateway caches the credential per instance. The budget stays at
organization scope, so it spans licenses.

### 4. Resolving the credential

The Go gateway did no shape validation and had no negative cache: an unknown
token was a signed round trip into Postgres every time. For license tokens only,
the gateway now checks the shape (prefix, 64 lowercase hex characters) and keeps
a negative cache of 30 seconds (`LicenseRefusalTTL`). Only final refusals enter
it. A control plane that could not answer has refused nothing. The cost is that a
fix, such as a license linked or a binding reset, takes up to 30 seconds to be
noticed by a gateway that just refused the token. Virtual key behaviour is
unchanged: the instance header is not read for a virtual key, its cache key is
the token hash as before, and it never enters the negative cache.

The auth cache was keyed on the token alone, and background refresh runs on a
detached context. The resolver signatures take a struct with the token and the
instance id, and the instance id is part of the cache key. A cached credential
is never served to another instance, and refresh keeps the instance id.

The control plane answers with stable codes, and the gateway's status switch
maps each one. Left unmapped, a terminal refusal would reach the caller as a
retryable 503.

| Code | Status | Meaning |
|---|---|---|
| `connect_license_not_registered` | 401 | the token is not in the registry |
| `connect_license_revoked` | 403 | revoked by LangWatch |
| `connect_license_expired` | 403 | the term has ended |
| `connect_wrong_instance` | 403 | bound to another instance |
| `connect_instance_required` | 400 | no `X-LangWatch-Instance` |
| `connect_service_not_entitled` | 403 | the license does not include the service |

The first five are declared in the Go gateway, so `herrgen` carries them into the
app's error registry and each has customer copy. Entitlement is checked by the
hosted route, not by the credential: a license with no hosted service still
authenticates, which is what the license sync needs. An unlinked license, one
recorded by a purchase that named no customer, answers as not registered.

A refusal names a code and nothing else. The caller may hold a token it should
not have, so no answer carries the customer, the seats or the term.

Binding on first use is one conditional update (`WHERE instanceId IS NULL`), so
two instances racing leave exactly one bound.

### 5. Classify is a gateway route that forwards to the one classifier

The plan asked for a check between a Go route with the judge as an upstream
provider and an ingress path to a TypeScript handler. Neither is chosen as
stated.

- A pure Go route would need a second implementation of the judge client, its
  token accounting and its rate limiter. The judge API is not OpenAI-compatible.
  Two implementations that both produce billable token counts will drift, and
  Cloud and connected customers would be charged by different code.
- The spend wire from the gateway is quantities only by design. It could carry
  `request_type=instant_eval` and input tokens, so the emitter was not the
  obstacle. The judge client was.
- A pure TypeScript route would have to re-implement license authentication,
  the budget check and the 402.

`POST /v1/instant-evals/classify`, `GET /v1/usage` and `PUT /v1/budget` are Go
routes in the authenticated `/v1` group. The gateway authenticates the caller,
runs the existing budget precheck for classify (the same `BudgetBreachError` and
402 a chat completion gets, fail-open when the precheck itself errors), then
posts a signed envelope `{virtual_key_id, organization_id, project_id, payload}`
to `POST /api/internal/gateway/connect/<operation>` on the control plane, with
`<operation>` one of `instant-evals-classify`, `usage`, `budget`. The gateway
relays the control plane's status and body as they are; a 5xx or an unreachable
control plane becomes `hosted_service_unavailable` (503). Request bodies above
2 MiB are refused with 413 before the envelope is built.

The identity in the envelope is what the gateway resolved, never what the caller
put in its payload. The control plane handler looks the managed key up in the
registry (`IssuedLicense.virtualKeyId`, active, same organization) and that
lookup is the entitlement check: a license without the service, a revoked
license, or a key that belongs to another organization is refused with 403
`connect_service_not_entitled` and the judge is never called. A virtual key may
read usage but has no license and cannot set a budget (403
`connect_license_required`). The handler answers a `HandledError` in the
gateway's own error envelope, `{error: {type, code, message, meta}}`, so an
install sees one shape whichever side refused.

The handler runs the process's one classifier under the license's hidden
governance project and charges the list rate only: the answer carries
`charged_usd` and never the provider cost. Spend is not written one row per
judged text. An install judging ten thousand conversations makes ten thousand
calls worth a few cents; they are summed per managed key and written every five
seconds, or every 500 calls under one key, as one `instant_eval` spend row with
`requests` set and `virtual_key_id` naming the install. A failed write is kept
and merged into the next window. The process flushes on shutdown
(`connect-spend` phase). The cost of this trade is stated: a crash loses no more
than one window, and the budget sees spend up to one window late.

The hosted handler does not consult the free Instant Evals allowance. A customer
organization has no Cloud subscription, reads as a free plan and would be cut
off after 1 USD. Its contract budget governs instead: a `GatewayBudget` on the
organization, `MANUAL` window, `BLOCK`, `externalId = connect-contract`, written
by the registry after every issue, revoke, term change and link, attributed to
the operator who made the change. Its default cap is the sum of the commits of
the licenses that count (active, not replaced by a live reissue). The maximum a
customer may set is the commit plus the overage maximum of each license with
overage enabled. A cap the customer lowered is kept across term changes unless
it is above the new maximum.

Budget figures reach the gateway on its 60 second config refresh. Overshoot is
bounded by the judge's sustained rate: 300,000 tokens a second for 60 seconds at
0.0546 USD per million tokens is about 1 USD, plus one spend window.

`GET /v1/usage` reads live spend from the ClickHouse budget ledger and reports
`spend_available: false` with `spent_usd: null` when it can not.
`GatewayBudget.spentUsd` in Postgres has had no writer since the ledger cutover
and is never read here.

`PUT /v1/budget` accepts `cap_usd` between zero and the contract maximum. Above
it, the refusal names the maximum (400
`connect_budget_above_contract_maximum`). A customer with no commit agreed has no
budget to set (409 `connect_budget_not_set`).

### 6. The sync lease is the grace rule

`POST /v1/license/sync` sends the token, the instance id, the version and the
two seat counts. It answers with a lease:
`{licenseId, instanceId, services, seatOverageAllowance, issuedAt, warnAfter,
validUntil}`, signed with the license key pair and verified with the public key
the install already embeds. `warnAfter` is 14 days out and `validUntil` is 30.

When sync fails, the allowance is kept without comment for 14 days. From day 14
to day 30 it is still kept, and admins see a warning that names the day it will
be withdrawn. After day 30 the install is back on the hard licensed cap. A sync
failure is shown in Settings, Connect from the first failure, so the cause can
be fixed long before the warning.

The default allowance is 20% of the licensed seats, rounded up. A license can
override it on its registry row.

The install applies the allowance where plan limits are resolved, so every
caller of the seat guard sees it: licensed seats plus the allowance while a
lease is valid, licensed seats alone once it is not. Existing members are never
locked out, which keeps the rule in `specs/licensing/seat-reconciliation.feature`.

A "last successful sync" timestamp in the install's own database was rejected.
An admin of a self-hosted install can edit a row. A lease that expires needs no
local clock to be trusted, and neither the allowance nor the two dates can be
forged without changing code. 30 days survives an outage, a holiday and a
firewall ticket, and is short enough that an install can not take the allowance
and stop reporting for a quarter.

Going over the licensed seats costs money later, so the install says so when it
happens: on the invitation and on the members page.

The install's identity on sync is the one it presents to the gateway (section
9): the organization id, or `LANGWATCH_CONNECT_INSTANCE_ID`. One identity for
both hosts, because the registry binds a license to one instance and a sync
that presented another id than the classify calls would be refused as the wrong
instance. It carries no organization name. The statistics post keeps its
payload, moves to the connect host when Connect is on, and stays off with
`DISABLE_USAGE_STATS`. `app.langwatch.ai/api/track_usage` keeps working for
older installs and for installs without Connect.

"Seat reconciliation" already names the in-app flow of disabling members down to
the license. The quarterly billing job is called the seat true-up everywhere.

What the registry keeps from a sync: the last report on the row (`lastSyncAt`,
`lastSyncVersion`, `reportedMembers`, `reportedMembersLite`) and the peak of the
license term quarter in `LicenseSeatReport`, keyed by `(licenseId,
quarterStartsAt)` and only ever raised. The quarter runs in three-month steps
from the license's own `issuedAt`, not from the calendar year, because that is
the term the seats were bought for. Sync is rate limited per registry row at 48
calls per 24 hours, answered `rate_limited` 429; a refused sync records nothing.

A reissued license travels inside the sync answer (`license`) until the install
presents the new token. The lease beside it still names the license being
replaced, so the install does not keep that lease: it applies the new license
through the same validation a pasted key gets, then syncs once more with the new
token. That second sync is what earns a lease for the new `licenseId` and what
tells the registry the replaced license is out of use: the replaced row is
marked superseded, its managed key is retired, and the encrypted copy held for
delivery is erased. A delivered license that does not verify is not applied and
the failure is shown in Settings, Connect.

The install reports its version from `SERVICE_VERSION`, then `service.version`
in `OTEL_RESOURCE_ATTRIBUTES`, then the package version, and `unknown` when none
is set. The chart sets `SERVICE_VERSION` from the app image tag when Connect is
on.

`POST /api/connect/v1/stats` and `POST /api/track_usage` are one handler behind
two routes, so switching Connect on changes the host the statistics report
travels to and nothing else about it.

### 7. Billing

Verified against the Stripe documentation and in Stripe test mode on 2026-09-19.

- Credit grants apply only to metered subscription items reported through
  Meters, and only when an invoice is finalized. With a quarterly invoice the
  Stripe credit balance can lag real use by a quarter. The cap and the remaining
  credit a customer sees therefore come from LangWatch's own budget ledger.
- Credit grants never apply to one-off invoice items. Seat lines can not draw
  down the usage commit.
- A credit grant invoices nothing. The commit is charged as a line on the annual
  one-off invoice, next to the seats, and the grant is created separately.
- A grant applies only when the invoice `period_end` is strictly before
  `expires_at`. A grant expiring at the end of the term would give the last
  quarter no credit. The grant expires 14 days after the term ends. The term
  itself is enforced by the budget and the license.
- A renewal grant is created only after the last usage invoice of the old term
  is finalized. Created earlier, it would absorb that term's overage.
- A customer can not hold two active subscriptions in different currencies.
  The usage subscription is USD only. Seats and the commit go on one-off
  invoices, which may be in another currency. One usage subscription is kept
  across terms. Its price is `interval: month, interval_count: 3`.
- Meter events are accepted only with a timestamp inside the last 35 days.
- Bank transfer on invoices requires `collection_method=send_invoice`. On a
  Dutch Stripe account, automatic matching covers EUR over SEPA and USD from
  banks in the United States. The transfer type is an onboarding input. Every
  other customer pays to LangWatch's own bank account, the invoice shows those
  instructions, and finance marks it paid out of band from the backoffice.
- Stripe has no setting that skips a small invoice and rolls it forward. Billing
  thresholds do the opposite. Roll-forward under 50 USD is an explicit command:
  a credit note on the small invoice, then a pending invoice item on the
  subscription for the same amount.
- The repository pins `stripe@15.12.0` at API version `2024-04-10`, which has no
  credit grants. A global bump would change subscriptions, checkout and webhooks
  for every Cloud customer, so it is not part of this change. A small adapter
  extends `StripeResource` for the credit grant endpoints and passes a
  per-request API version. A probe created a grant, read its balance and voided
  it in test mode through that adapter.

Onboarding is one idempotent action: invoice customer, quarterly metered
subscription anchored at the start of the term, credit grant, and an
organization budget equal to the commit with window `MANUAL` and breach action
`BLOCK`. Each step stores the id it created, so a run that failed halfway
resumes.

The seat true-up runs on a daily worker tick and dispatches a checkpointed
command per license and term quarter, after the quarter has closed. Added seats
are the quarter's highest reported count minus the seats already invoiced. The
amount is `added seats * annual seat rate * days remaining / term days`, rounded
to the cent, where the days remaining start the day after the quarter closes.
Nothing is backdated. It is its own one-off invoice in the currency of the seat
contract, because seat lines can not ride a USD usage subscription. Seats are
not credited back mid-term. A license that never synced in a quarter is flagged
and not invoiced on a guess.

`reportUsageForMonth` skips organizations that are not on `SEAT_EVENT` pricing.
A connected customer organization is not, so it is admitted explicitly through
its `selfHostedCustomer` mark, or its hosted usage would never reach the meter.

### 8. The `langwatch` provider

A self-hosted gateway gets a provider type `langwatch` that forwards
OpenAI-compatible calls to the configured gateway endpoint with the license
token and the instance id. It reuses the OpenAI-compatible dispatch lane that
`custom` providers use. `langwatch` is added to the closed set of provider
families; without that, `langwatch/gpt-5-mini` would be read as a model name
and match no credential without an error. The entitlement is `managed_models`.
Routing by evaluation results is not built.

### 9. What the install decides, and where

The install side lives in `platform/app/ee/licensing/connect/install/`. Four
decisions:

**Which classifier judges.** Three in order: the install's own `JEV_API_KEY`,
then Connect when `LANGWATCH_CONNECT_ENABLED` is set, then the null classifier.
An install that configured a judge of its own keeps judging with it and sends
nothing to LangWatch, whatever else is switched on.

**Which organization may judge through it.** Hosted judging is switched on per
organization, stored in `Organization.connectServices` and empty by default, so
one organization on a shared install can use it while another does not. The
access gate (`src/server/app-layer/instant-evals/access.ts`) already resolves
the project's organization for the feature flag, so it asks the classifier
whether it can judge for that organization: one that has not switched the
service on sees the eval functions published as unavailable rather than queries
whose judged columns all come back null. The opt-in and the credential are held
per project and per organization for 30 seconds, so a run of ten thousand
judgements reads the row once and an admin's decision takes effect without a
restart.

**What identifies the install.** The instance id is the organization id of the
organization whose license is used, unless `LANGWATCH_CONNECT_INSTANCE_ID`
names one. It survives restarts, backups and hostname changes: a restore of the
same database keeps the identity, while a second install with a database of its
own presents another id and is refused as `connect_wrong_instance`.

**Two refusals the host cannot name.** `connect_unreachable` carries the host
and port an outbound rule has to allow, and `connect_budget_exhausted` says the
cap is the customer's own and is raised in Settings, Connect. Every other
refusal crosses the wire as the code the host wrote, so one piece of copy
covers both sides. Outbound calls use undici's `EnvHttpProxyAgent` when any of
`HTTPS_PROXY`, `HTTP_PROXY` or `NO_PROXY` is set.

## Existing offline licenses

A customer on an offline license must notice nothing when they upgrade. Where a
cleaner design and this guarantee disagree, the guarantee wins. Each line names
the test that pins it.

| Guarantee | Pinned by |
|---|---|
| A license issued before this change verifies with the same public key and the same schema, and re-serializes byte for byte. | `ee/licensing/__tests__/offlineLicenseCompat.unit.test.ts`, on a fixture minted with the licensing code of `origin/main` |
| The embedded production public key is unchanged. | same file, "is still verified against the production public key main shipped" |
| With no `connect.*` value set, seat enforcement is the same hard cap: the seat past the licensed count is refused, the one within it is admitted. | same file, "keeps the hard seat cap" and "keeps admitting a seat within the licensed count" |
| Validating and enforcing an offline license makes no network call and never reads the registry. | same file, "makes no network call and never reads the registry": `fetch` is stubbed to throw, and the database stub throws on any model but `Organization` |
| No new required environment variable or Helm value. `connect.enabled` defaults to off, and every `LANGWATCH_CONNECT_*` variable is optional. | `offlineLicenseCompat.unit.test.ts`, "parses with every Connect variable absent, and resolves them all to off" |
| With no `LANGWATCH_CONNECT_*` set and no judge key, the deployment gets the null classifier and neither `fetch` nor undici is called. | same file, "uses the classifier for an install with no judge key, and calls nothing" |
| A chart render that changes no value carries no `LANGWATCH_CONNECT_` variable at all. | `charts/langwatch/tests/connect-env.sh` |
| The migration is additive and needs only the normal `prisma migrate deploy`: one enum, one empty table, one column with a default. | `20260919120000_issued_license_registry`, replayed on a scratch database |
| The usage statistics worker behaves as before and `/api/track_usage` stays. | `track-usage-security.integration.test.ts` stays green; the worker only gains a separate sync when Connect is enabled |
| The license page of an install is unchanged. The one control removed, "New License", was only ever rendered on LangWatch Cloud. | `LicenseStatus.integration.test.tsx` |

The registry and the token derivation exist only on the issuing and the hosted
side. `validateLicense`, `LicenseHandler` and the seat guard import neither.

## Threat model

| Threat | What happens | Bound |
|---|---|---|
| A license key leaks (an email is forwarded) | Once an install has bound the license, a caller without its instance id is refused. Before first use, the attacker can bind first; the real install then sees `connect_wrong_instance`, and LangWatch reissues and revokes. | Spend is capped by the organization budget. License keys stop travelling by email once sync delivers them. |
| The token and instance id are replayed from another network | Both travel only under TLS to the two hosts. They are bearer secrets; replay with both succeeds. | The budget cap, per-license spend rows that make the use visible, and revocation in seconds. |
| A revoked license with a cached gateway credential | Revoking revokes the managed key; the change feed evicts the cache entry on the next poll. The 15 minute JWT expiry is the backstop. | While the control plane is unreachable the gateway serves stale entries for up to its 6 hour hard grace. Exposure is capped by the budget. |
| Hash enumeration | The token is the SHA-256 of a payload that contains a 2048-bit RSA signature. It can not be guessed. The shape check and the negative cache keep a flood of unknown tokens off Postgres. | Refusals never include customer name, seats or term. |
| A read of the registry table | Rows hold `sha256(token)`, never the token, and a SHA-256 of a 256-bit value can not be reversed. A held reissued license is encrypted. | The encryption key lives outside the database. |
| A self-hosted admin tampers with the client | They can forge nothing LangWatch signs: not a license, not a lease. They can patch the seat guard out of their own build, as they always could. Hosted usage can not be under-reported because LangWatch meters it. Seats can be under-reported by a patched build. | A license that stops syncing is flagged in the backoffice, and the contract's audit clause covers the rest. |
| A customer changes its own cap | `PUT /v1/budget` is bounded by the contract maximum on the registry row. | The install only offers it to organization admins. |

## Operator names

| Kind | Name |
|---|---|
| Env (Cloud) | `LANGWATCH_LICENSE_PRIVATE_KEY`, `STRIPE_SECRET_KEY` |
| Env (install) | `LANGWATCH_CONNECT_ENABLED`, `LANGWATCH_CONNECT_LICENSE_ENDPOINT`, `LANGWATCH_CONNECT_GATEWAY_ENDPOINT`, `LANGWATCH_CONNECT_INSTANCE_ID`, `DISABLE_USAGE_STATS`, `HTTPS_PROXY` |
| Helm | `app.connect.enabled`, `app.connect.licenseEndpoint`, `app.connect.gatewayEndpoint`, `app.connect.instanceId` |
| Install opt-in | `Organization.connectServices` (empty by default) |
| Gateway host | `POST /v1/instant-evals/classify`, `GET /v1/usage`, `PUT /v1/budget` |
| Control plane, gateway only | `POST /api/internal/gateway/connect/:operation` (HMAC signed) |
| Connect host | `POST /v1/license/sync`, `POST /v1/stats` |
| Contract budget | `GatewayBudget.externalId = connect-contract`, metadata `connect_cap_set_by` |
| Error codes | `connect_service_not_entitled`, `connect_license_required`, `connect_budget_not_set`, `connect_budget_above_contract_maximum`, `connect_budget_exhausted`, `connect_disabled`, `connect_unreachable`, `hosted_service_unavailable` |

## Consequences

- An air-gapped install is unchanged: no sync, no hosted services, hard seat cap.
- Hosted services fail closed when the gateway is down. The install keeps
  running for everything else.
- The Stripe adapter is a second path to the Stripe API with its own API
  version. It goes away when the SDK is bumped for the whole billing module.
- DNS and ingress for the two hosts live in the infrastructure repository and
  are listed in the pull request.
