# ADR-063: Automations domain packages, versioned customer API, and the agent-first operator surface

**Date:** 2026-07-22

**Status:** Proposed

**Builds on:** ADR-037 (operator surfaces), ADR-040 (webhook channel), ADR-041
(Block Kit templates), ADR-043 (facet model), ADR-044 (scheduled reports),
ADR-045 (handled errors), ADR-052 (process-manager substrate), ADR-060
(model-emitted blocks).

## Context

The automations *engine* is done. ADR-052's process-manager pipeline, the
ADR-044 durable scheduler, reports, graph alerts, the five delivery actions
(Slack, HTTP webhook, email, dataset, annotation queue), Liquid templating,
and the at-most-once dispatch contracts are all implemented and running. What
is fragmented is everything *around* the engine:

- **The domain code has no single home.** Pure vocabulary lives in
  `@langwatch/automations` (providers, cadences, templating, enums); services,
  repositories, delivery senders, and dispatch live in
  `src/server/app-layer/automations`; pure evolve/wake logic is interleaved
  with pipeline wiring in `src/server/event-sourcing/pipelines/automations`.
  Nothing outside the app can reuse the services, and the app's typecheck
  graph pays for the tangle.
- **The customer-facing REST surface is the worst code in the domain.**
  `/api/triggers` predates the service layer: it calls Prisma inline, its
  action enum is missing `SEND_WEBHOOK`, it is unversioned, and it returns
  `actionParams` secrets (Slack webhook URLs, bot tokens, webhook auth
  headers) unredacted on read — the tRPC surface redacts, the REST surface
  never did.
- **The versioned API framework has no adopters.** `@langwatch/api`
  (`langwatch/packages/api`) — the Hono builder with date versioning,
  input/output Zod validation, OpenAPI generation, and `HandledError`
  serialization — shipped with no consumers. Automations is the natural first
  adopter.
- **The operator page is three feature landing pages stacked.** The current
  `/automations` page splits one list across tabs, leads with stat cards that
  read zero, and makes the user pick the taxonomy (Automation vs Alert vs
  Schedule) before they can express an intent. The redesign spec (four page
  states: empty → composing → populated → firing) inverts this: the user
  states an outcome, the system derives the kind.
- **Nothing composes automations for the user.** There is no natural-language
  authoring, no suggestions engine, no silence primitive, and Slack app
  delivery requires manually pasting a bot token.

See the behavioural contracts this decision supports:
[`specs/automations/customer-api.feature`](../../../specs/automations/customer-api.feature),
[`specs/automations/page-states.feature`](../../../specs/automations/page-states.feature),
[`specs/automations/agent-composing.feature`](../../../specs/automations/agent-composing.feature),
[`specs/automations/suggestions.feature`](../../../specs/automations/suggestions.feature),
[`specs/automations/silence.feature`](../../../specs/automations/silence.feature),
[`specs/automations/slack-app-install.feature`](../../../specs/automations/slack-app-install.feature).

## Decision

Consolidate the automations domain into two workspace packages, expose it to
customers through a versioned API built on `@langwatch/api`, rebuild the
operator page around the four-state redesign with Langy as the composer, and
add the three missing primitives (silence, suggestions, Slack app install).
The tRPC router remains the UI's transport; REST is for customers and agents.
Both become thin transports over one package-owned service layer.

### 1. Two packages, one dependency direction

Two packages rather than one so the dependency graph stays acyclic: light
consumers (web UI, CLI, MCP server, SDKs) import contracts without pulling in
services, and the server package depends downward only.

**`@langwatch/automations`** (existing, extended) — the pure domain and
contracts package. No database, no React, no server-only dependencies.

```
packages/automations/src/
  domain/          # entities + invariants: Rule (kind: automation|alert|report),
                   #   facets (ADR-043), status model, silence state
  contracts/       # strict Zod DTOs: create/update/list/read shapes as
                   #   kind-discriminated unions; redacted read schemas
  repositories/    # repository INTERFACES only (TriggerRepository,
                   #   FireHistoryRepository, WebhookDeliveryRepository,
                   #   ScheduledJobPort, SlackIntegrationRepository, …)
  providers/       # (existing) per-channel shared definitions
  templating/      # (existing) Liquid engine, renderers, defaults
  cadences.ts      # (existing)
  enums.ts         # (existing) Prisma enum mirrors, parity-test pinned
  utils/
```

**`@langwatch/automations-server`** (new) — services and outbound edges.
Depends on `@langwatch/automations`, `@langwatch/api`,
`@langwatch/handled-error`, `@langwatch/observability`, `@langwatch/ssrf`.
Still no Prisma and no React: it consumes the repository interfaces and
receives implementations by injection.

```
packages/automations-server/src/
  services/        # AutomationService, SilenceService, SuggestionService,
                   #   TemplateService, FireHistoryService, SlackIntegrationService
  clients/         # slack (incoming webhook + Web API), http webhook
                   #   (SSRF-guarded), email sender port
  event-sourcing/  # event/command/intent Zod schemas + pure evolve/wake
                   #   functions for the ADR-052 process managers
  api/             # the versioned customer API: a dependency-injected
                   #   factory built with @langwatch/api's createService
  errors.ts        # HandledError subclasses for the domain (ADR-045)
```

**What stays in the app** (`langwatch/src/`):

- `server/app-layer/automations/repositories/*.prisma.repository.ts` and the
  ClickHouse audit repository — the only code that knows the database.
- `server/event-sourcing/pipelines/automations/` — pipeline *wiring* only
  (`.withProcessManager`, subscribers, composition root); the evolve/wake
  logic and schemas it mounts come from the server package.
- The tRPC `automation` router — reduced to a thin transport over the
  package services.
- `features/automations/` — the React UI and the client halves of providers.
- The app's composition root (`app-layer/presets.ts`) constructs the services
  with the Prisma implementations and passes them to both transports.

Langy's layering (`app-layer/langy/repositories|execution|streaming` +
pipeline wiring) is the precedent; this takes it one step further by moving
the transport-independent layers out of `src/server` entirely. Both packages
follow the repo tsconfig rules (`incremental` + per-package
`tsBuildInfoFile`), which also advances the measured package-split typecheck
plan.

### 2. The customer API — RPC-shaped, first adopter of `@langwatch/api`

A versioned service at `/api/automations/{version}/…`, defined in
`@langwatch/automations-server/api` as a factory the app route mounts:

```ts
// packages/automations-server/src/api/service.ts
export function buildAutomationsApi(deps: {
  auth: MiddlewareHandler;
  services: AutomationsServices;   // constructed at the app composition root
}) {
  return createService({ name: "automations", auth: deps.auth })
    .provide({ automations: () => deps.services })
    .version("2026-08-01", (v) => {
      v.post("/create_rule", { input: createRuleInput, output: ruleRead, status: 201 }, …);
      v.post("/list_rules",  { input: listRulesInput, output: ruleList }, …);
      // … one POST per operation
    })
    .build();
}
```

- **RPC operations, not REST resources.** Every operation is a verb-named
  `POST /{version}/{operation}` with exactly one input schema and one output
  schema — the shape of an agent tool call. OpenAPI operation ids are the
  snake_case operation names, so MCP tools, CLI commands, and customer
  agents map onto the API 1:1 with no route/verb/path-param inference. v1
  operations:
  - `create_rule` · `get_rule` · `list_rules` · `update_rule` ·
    `delete_rule`
  - `enable_rule` · `disable_rule` · `silence_rule` · `unsilence_rule` (§4)
  - `test_fire_rule` (banner-marked test dispatch, per the ADR-037
    contract)
  - `get_rule_status` (health, firing, last fired, next run) ·
    `list_rule_fires` (fire history) · `list_rule_deliveries` (webhook
    delivery log)
  - `list_suggestions` · `dismiss_suggestion` (§5)
  - `list_slack_channels` (channel picker for app-mode delivery, §6)
- **One rule shape, kind-discriminated.** Rule payloads are a Zod
  discriminated union on `kind: "automation" | "alert" | "report"` — the
  ADR-043 facet model on the wire. Kind-specific facets (threshold +
  severity for alerts, cron + timezone + content source for reports,
  filters + digest window for trace automations) are members of the union,
  not optional soup.
- **All five channels** are expressible in `delivery`: Slack (incoming
  webhook or installed app + channel), HTTP webhook (ADR-040 semantics),
  email, dataset, annotation queue.
- **Secrets are write-only.** Read DTOs in `contracts/` structurally exclude
  secret material: webhook URLs and tokens return masked
  (`"https://hooks.slack.com/…/••••"`, header values as `"••••"`), reusing
  the existing `redactActionParamsFor` logic, now owned by the contracts
  package and enforced by the API's `output` schemas. This closes the
  `/api/triggers` leak by construction — the read schema cannot represent
  the secret.
- **Strict handled errors, built for agents.** Every failure is a typed
  `HandledError` per ADR-045 — stable `code`, `meta`, `fault`, and, on every
  customer-actionable error, `tips` and `docsUrl` from the remediation
  registry. Agents driving the API (Langy, MCP, CLI, customer agents) get
  machine-readable causes and authored remediation instead of prose. The
  OpenAPI document is complete — schemas, error envelopes, and descriptions
  — because for agent consumers the docs are the integration.
- **Deprecation of `/api/triggers`.** The legacy route immediately gains
  `Deprecation` + `Sunset` headers and a docs pointer, stops being
  documented, and is removed after a migration window. Its secret leak is
  not patched in place — the replacement is the fix, and the window is
  short.

### 3. tRPC stays, but thins

The UI keeps tRPC (session auth, React Query integration, no reason to
churn). The 1,263-line `automation` router is reduced to parameter parsing +
service calls using the same contracts and services as the REST API. One
service layer, two transports; behaviour cannot drift between surfaces
because neither surface owns behaviour.

### 4. Silence — a first-class primitive

`Trigger.silencedUntil DateTime?` (additive migration). Semantics:

- While `now < silencedUntil`, dispatch suppresses the rule's *effects* —
  notifications are not sent, persist-class actions do not write. Evaluation
  and incident tracking continue: matches are still recorded, an alert's
  breach/recover state still moves, fire history notes suppressed fires.
- Silence is temporary by construction (a timestamp, not a flag); `active`
  remains the permanent off-switch.
- Exposed on both transports (`POST /:id/silence { until }` REST;
  tRPC mutation for the UI's "Silence 1h") and rendered in list/status
  surfaces ("Silenced · 43 min left").

### 5. Suggestions — deterministic detectors

A `SuggestionService` in the server package computes suggestions from
project telemetry and existing rules — no LLM in the loop. v1 detectors:

1. **Error spike without an alert** — error-rate breaches in the last 30
   days with no active error alert.
2. **Failed evaluations going nowhere** — failing eval traces with no
   dataset/annotation-queue rule collecting them.
3. **Spend growth without a cost alert** — month-over-month token cost
   growth beyond a threshold with no cost alert.

Each suggestion carries the facts (counts, period) and a pre-filled draft
rule the UI or Langy can open. Dismissals persist per project + detector.
The populated page shows at most one suggestion row (the artifact's "earns
attention by being right" rule); the empty page may show more.

### 6. Slack app install

Replace manual bot-token pasting with a proper OAuth v2 install flow. The
delivery machinery already exists (`chat.postMessage`, `conversations.list`,
retryable-error classification, scope remediation copy); what is missing is
acquisition and storage of the token.

- **`SlackIntegration`** model: one per organization (projects select a
  channel against the org install), storing the encrypted bot token, team
  id/name, granted scopes, and installer. Encrypted at rest with the
  existing secrets encryption; the token is never returned by any read
  API (same write-only rule as §2).
- **Install flow:** settings-initiated OAuth redirect → callback exchanges
  the code, stores the integration, returns to settings. Scopes:
  `chat:write`, `chat:write.public`, `channels:read`.
- **Channel picker** backed by `conversations.list` under the stored token —
  the drawer and the agent both use it.
- **Delivery config union** widens: `slack` delivery is `{ mode: "webhook",
  url }` or `{ mode: "app", channelId }`. Incoming webhooks remain fully
  supported; the manual-token path folds into the integration as an
  import.
- This also unblocks the ADR-041/044 deferred bot-token paths (threaded
  dashboard reports, `data_visualization` blocks) — not built here, but the
  token they were waiting for now exists.

### 7. The operator page — four states, taxonomy derived

Rebuild `/automations` (flag: `release_automations_redesign`) per the
redesign spec:

- **Empty:** one question ("What should happen automatically?"), three
  outcome cards in plain language (tell me when… / send me… / do something
  when…), an NL input, and detector-seeded suggestions. No stat cards, no
  tabs, no taxonomy picker.
- **Composing:** the NL intent produces a Langy plan card (§8). Outcome
  cards open the same flow with the intent pre-framed.
- **Populated, quiet:** one list; every rule reads as a sentence
  ("Error rate above 5% → Slack #oncall"), status dot leading, kind badge
  trailing (Alert / Schedule / On trace), filter pills, a one-line prose
  header ("All quiet — nothing firing, next digest Monday 09:00"), at most
  one suggestion row. Sorting: status severity, then activity recency.
- **Firing:** the firing rule takes over the top as an incident row —
  current value, duration, notified-where, recurrence count — with **View
  traces** and **Silence 1h**. Healthy rules dim below a "everything else is
  healthy" strip. Recovery returns the page to quiet automatically.
- **Copy:** the page is **Automations**; individual rows are **rules**
  ("+ New rule", "1 rule firing"). Kind badges say Alert / Schedule / On
  trace — the internal enum names never surface.
- The staged authoring drawer (ADR-037/043, `authoring-drawer.feature`)
  remains as the **Edit details** escape hatch, pre-filled from a plan or an
  existing rule. It is no longer the primary creation path.

Status derives from data that already exists (`getTriggerStats` firing
state, `TriggerSent` incidents, `ScheduledJob.nextRunAt`); the page-level
prose header and incident takeover are presentation, not new state.

### 8. Langy composes; the human approves

The composing state is Langy with automation-authoring tools:

- **Tools over the same services:** draft-rule (validate a candidate rule
  against contracts without saving), inspect prerequisites (does the cost
  graph this alert needs exist?), create prerequisite (create the custom
  graph), create/update rule, list existing rules + suggestions. Every
  mutation goes through the same package services with the same validation
  — the agent cannot reach around the domain.
- **The plan card is an ADR-060 derived card:** Watch / Trigger / Notify
  lines plus an "Also" line for prerequisites the agent will create.
  Approve / Edit details / Cancel are the card's actions; approve executes
  the plan (prerequisites first, then the rule), Edit details opens the
  drawer pre-filled, and a correction ("use email instead") is just another
  turn that re-emits the card.
- Nothing is created before approval. The plan card states everything the
  approve will do; a failed step surfaces as a handled error on the card.

### 9. Phasing

| Phase | Ships | Depends on |
|-------|-------|------------|
| P1 | Package restructure: contracts/domain/interfaces into `@langwatch/automations`; services/clients/event-sourcing/api-factory into `@langwatch/automations-server`; app keeps impls + wiring; tRPC delegates. No behaviour change. | — |
| P2 | Customer API v1 (`2026-08-01`) + OpenAPI + deprecation headers on `/api/triggers`. | P1 |
| P3 | Silence primitive (migration, dispatch honor, both transports). | P1 |
| P4 | Four-state page behind `release_automations_redesign` (states 00/02/03; composing opens the drawer until P7). | P3 |
| P5 | Suggestion detectors + feed. | P1 |
| P6 | Slack app install + channel picker + `mode: "app"` delivery. | P1 |
| P7 | Langy composing (tools + plan cards). | P4, ADR-060 blocks |
| P8 | `/api/triggers` removal after the migration window. | P2 |

P2–P6 are parallelizable after P1. Riskiest first: the restructure is a
large mechanical move that must land with zero behaviour change — it is
deliberately its own PR with the parity test suite as the gate.

## Rationale / Trade-offs

- **Why two packages instead of one.** A single package holding contracts
  *and* services forces every light consumer (UI, CLI, MCP) to compile the
  service layer, and invites cycles the moment another domain package needs
  automations contracts while automations services need that domain's
  client. Contracts-only packages are leaves; server packages depend on
  leaves; the app depends on both. The cost — one more package — is small
  and the repo already runs a multi-package layout.
- **Why repository interfaces in the domain package but implementations in
  the app.** The interfaces are part of the domain's language; the
  implementations are bound to Prisma's generated client and the app's
  database lifecycle. Keeping implementations app-side avoids making the
  packages depend on generated artifacts and keeps `pnpm typecheck` graphs
  honest.
- **Why the API factory lives in the server package, not an app route
  file.** The service definition *is* domain surface — its schemas, error
  mapping, and versioning policy belong with the services it fronts. The
  app contributes exactly what it owns: auth middleware and constructed
  dependencies. This also makes the API testable without Next.js.
- **Why an RPC-shaped API rather than REST resources.** The primary
  consumers are agents, and an agent integrates by binding tools to
  operations: `create_rule` with one input schema is a tool; `PATCH
  /rules/:id` with path params, partial bodies, and verb semantics is an
  exercise in inference. Verb-named POSTs also make the OpenAPI document
  self-describing per operation and keep every call's contract to exactly
  one input and one output schema. We give up HTTP caching and RESTful
  affordances that none of the intended consumers use.
- **Why an HTTP API for customers and tRPC for the UI, not one transport.**
  The API's consumers are agents and integrations that need versioning,
  OpenAPI, and stable errors; the UI needs session auth and React Query.
  Forcing either onto the other's transport buys churn, not convergence —
  convergence comes from the shared service layer.
- **Why deprecate `/api/triggers` rather than patch it.** Patching
  redaction into an unversioned, service-less route spends effort making
  the wrong surface safer to keep. The replacement exists in the same
  release; a short window with `Deprecation` headers is the cheaper and
  cleaner path. (Public copy for this describes the rule now in force —
  reads are redacted, secrets are write-only — not the historic hole.)
- **Why deterministic suggestions, not Langy-generated.** Detector output
  must be cheap, explainable, and always-on (it renders on page load).
  Three detectors with clear predicates beat an LLM sweep on cost and
  trust; Langy still gets the detector facts as tool output and can narrate
  or extend them in conversation.
- **Why silence keeps evaluating.** Suppressing effects while tracking
  state means un-silencing shows the truth ("still firing, 7.8%") instead
  of a blind spot, and fire history stays honest about what was suppressed.
- **What we compromise.** The restructure is a big diff with no user-visible
  payoff of its own; the Slack OAuth flow adds a real credential store we
  must encrypt and audit; and running the redesigned page and the legacy
  page behind a flag doubles the surface until GA. Judged worth it against
  building the customer API on top of the current tangle and hand-rolling a
  fourth bespoke REST route.

## Consequences

- `@langwatch/automations` becomes the single source of truth for domain
  models, contracts, and repository interfaces; `@langwatch/automations-server`
  for services, clients, event-sourcing logic, and the customer API. The
  app-layer automations directory shrinks to implementations + wiring.
- `@langwatch/api` gains its first production adopter, validating the
  builder (versioning, OpenAPI, error formatting) against a real domain.
- Customers and agents get a versioned, documented, strictly-typed
  automations API whose reads cannot leak secrets; `/api/triggers` is
  deprecated and later removed.
- The `Trigger` model gains `silencedUntil`; a `SlackIntegration` model and
  OAuth flow enter the platform; a `SuggestionDismissal` store appears.
- The operator page becomes the four-state surface; the staged drawer
  demotes to the escape hatch; "rule" enters the product vocabulary for
  rows.
- Langy gains automation-authoring tools and its first ADR-060 derived-card
  consumer in production.
- Follow-ups deliberately out of scope: threaded Slack dashboard reports and
  `data_visualization` blocks over the bot token (ADR-041/044 deferrals),
  idempotency keys on API writes, per-severity throttling and quiet hours
  (the ADR-043 cadence growth points), and MCP/CLI automation commands over
  the new API.

## References

- Redesign artifact: "Automations, redesigned — state spec" (four page
  states; one creation entry point; taxonomy derived, not chosen; status
  leads; prose over stat cards; agent proposes, human approves).
- ADR-037, ADR-040, ADR-041, ADR-043, ADR-044, ADR-045, ADR-052, ADR-060.
- `langwatch/packages/api/README.md` — the versioned service builder.
- `src/server/app-layer/automations/` — the service layer being moved.
- `src/server/app-layer/automations/delivery/slackWebApi.ts` — the existing
  bot-token delivery path the install flow feeds.
- Specs: see Context.
