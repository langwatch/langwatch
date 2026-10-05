---
name: module-dependencies
description: "What a LangWatch module may demand and how: the four-way rule (store-derived, peer *Api, config or secret, availability decided inside the module), static dependencies, Config.define and Secret.load in the contract, process facts, the four capability layers (availability, entitlement, permission, release flag), enterprise modules and declared plan gates, and peer cycles: reading the peer-cycles policy and cutting a cycle from the reactor's side with a peer subscriber. Use when someone says 'add a peer', 'depend on another module', 'static dependencies', 'which Api do I call', 'where does this env var go', 'Secret.load', 'secrets.into', 'process fact', 'is this feature available', 'capability', 'entitlement', 'enterprise module', 'withEntitlement', 'peer cycle', 'peer-cycles', 'cut the cycle', 'reverse the dependency', 'withPeerSubscriber', or 'config_collision'."
user-invocable: true
---

# Module dependencies: what a module may demand

The record is `dev/docs/ARCHITECTURE.md` §3.3 (the four-way rule), §3.5 (capability layers),
§5 (peers and peer cycles), §6 (config and secrets) and §11 (enterprise). Search by heading;
section numbers move. This skill restates nothing the record does not say, and names the check
behind each rule. Where none exists it says `unbacked`.

## The four-way rule (§3.3)

Every dependency a module has is exactly one of these. Sort it before you write anything.

| The thing you need                                          | It is                                     | Where it goes                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Derivable from an opened store (tenant resolver, actor row) | a repository or channel inside the module | the module's `{ live, memory }` registry, which `requires` the store client (§5)                                                   |
| Another module's capability                                 | a peer                                    | the `*Api` token in `static dependencies`; `create()` receives the typed implementation                                            |
| A deployment fact (signing key, base URL)                   | config or a secret                        | the contract's `<name>.config.ts`: `Config.define` leaves and `Secret.load` handles; a shared fact is the shared leaf by name (§6) |
| Whether this deployment has it at all                       | an availability decision                  | decided inside the module from its own config and secrets; off refuses by name with a stable code (§6)                             |

A module class receives `repositories`, `channels`, `dependencies`, `config`, `secrets`, `role`
and `resources`, never a bag of clients or facts. Members and supply tokens are deleted (§3.3,
§15); a test stubs a peer with `createApiFixture` (§13).

Members are removed now, before other module work (Alex, 2026-10-05). Where each kind goes (record
§3.3, coordinator members wave, 2026-10-05):

| A member that was                                  | Becomes                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `encryption`                                       | a registry input: the live registry `requires` it and the live Prisma repository seals; memory twins hold plaintext |
| `rateLimiter`                                      | `<module>-rate-limit.repository.ts` with a memory fixed-window twin, wrapping the store's limiter (keys unchanged)  |
| `publicBaseUrl`, `nlpServiceUrl`, `serviceVersion` | the shared leaf from `@langwatch/config`, added to the contract's config (§6)                                       |
| `nlpInternalSecret`                                | the shared handle from `@langwatch/secrets`                                                                         |
| `logger`                                           | `createLogger("langwatch:<module>[:<part>]")` inside the module                                                     |
| `processName`                                      | the role (deleted, §15)                                                                                             |
| `clock`                                            | `@langwatch/time`; memory twins take it in their registry                                                           |
| anything another module answers                    | a peer `*Api` in `static dependencies`                                                                              |

When two modules both want a config fact, one of them usually owns it and the other should ask
(§6). When a module owns the value, others read the owner contract's exported leaf (§16, "Homes
for the no-members migration", which supersedes the 2026-09-18 ask-the-owner rule).

## Backed by

Each rule this skill teaches, and what refuses its violation. `unbacked` rows are the lint-rule
backlog; the proposal is a proposal, not a ruling.

| Rule (record)                                                                                      | Backed by                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another module is reached only through its contract and `*Api` (§3, CLAUDE.md rule 1)              | `langwatch/package-boundaries` (`crossModuleProcess`, `processOutsideModule`, `crossModuleBrowser`)                                                                                     |
| Store clients reach repositories and channels only (§3.3 way 1, §5)                                | `langwatch/store-containment` (`storeClientValue`, `storeNamed`, `storeInApplication`)                                                                                                  |
| Peers are tokens; `create` is the only builder (§5)                                                | the compiler (a typo in `static dependencies` fails); `langwatch/module-classes` (`create`, `publicConstructor`)                                                                        |
| Uninstalling a module a peer depends on fails (§5)                                                 | the compiler, naming the dependent                                                                                                                                                      |
| Module code never reads `process.env` (§3.3 way 3, §6)                                             | `langwatch/environment-boundaries`                                                                                                                                                      |
| Config is drilled; nothing resolves its own (§6)                                                   | `langwatch/service-loads-its-own-config`                                                                                                                                                |
| One env var has one owner (§6)                                                                     | boot: `ConfigCollisionError`, code `config_collision` (`packages/config/src/config.errors.ts`); policy `feature-configuration` only sees `env: "NAME"` bindings, not `c.env("NAME", …)` |
| A secret resolves only inside `secrets.into`, and only during boot (§6)                            | runtime: `SealedSecretsError` (`secret_sealed`), `SecretClaimedTwiceError` (`packages/secrets/src/secrets.errors.ts`); nested `into` is `unbacked`                                      |
| No members, supply tokens or bags; no feature leaf in `packages/config` (§3.3, §6, §15)            | `unbacked`: `dev/docs/deleted-spellings.json` lists them, no guard reads it yet (plan step 2)                                                                                           |
| A module decides its own availability; public config projects that answer (§3.3 way 4, §3.5)       | `unbacked`; the record names the rule to come: no availability logic in `*.config.ts` projections, off states use the shared notice                                                     |
| Plan gates are declared with `withEntitlement`, never hand-rolled (§7 "The plan gate is declared") | `langwatch/no-hand-rolled-plan-gate`                                                                                                                                                    |
| Plan limits come from the `@langwatch/plans` catalogue (§3.5 bounds)                               | `langwatch/plan-literals`                                                                                                                                                               |
| Enterprise-licensed code lives in an enterprise module (§11)                                       | `langwatch/enterprise-license-header`; `langwatch/package-boundaries` (`coreImportsEnterprise`)                                                                                         |
| Enterprise routes are always mounted and refuse per organization (§11)                             | `unbacked`                                                                                                                                                                              |
| No package-import cycle (§3)                                                                       | policy `cycles`                                                                                                                                                                         |
| No peer cycle (§5)                                                                                 | policy `peer-cycles`; `packages/architecture-enforcer/tests/boundary-ratchets.unit.test.ts` ("No peer cycle edge exists"), red until the last cut                                       |
| No peer-cycle edge is cut or listed without asking Alex (§5, 2026-10-05)                           | a human gate; not a lint candidate                                                                                                                                                      |
| A new `*Api` operation is a design choice (architecture guide rule 5)                              | `unbacked`; a review item in the `architecture-review` skill, not a lint rule                                                                                                           |
| Removing a cycle may not make a synchronous precondition eventual (§5)                             | `unbacked`; `architecture-review`                                                                                                                                                       |

## Capability layers (§3.5)

"Capability" means four layers, each with one owner. No layer re-derives another's answer.

1. **Deployment availability**: the owning module, from its own config and secrets; the browser
   reads a public-config boolean projected from that same answer.
2. **Entitlement**: `EntitlementApi`; the route stays mounted and refuses per organization.
   Declare `withEntitlement(entitlement, { feature, when })` on the route or procedure.
3. **Permission**: authz; `.withPermission(...)` on the route, the service for row-dependent checks.
4. **Release flag**: feature flags.

Off is opaque: the screen says only "contact LangWatch support" or "contact your administrator".
Fixed bounds read `@langwatch/plans`; per-organization bounds ask `EntitlementApi`. Host services
(session, navigation, storage, toasts, drawers) are not capabilities.

## Enterprise (§11)

An enterprise module has the module shape and installs from the same catalogue. Core imports an
enterprise contract or client like any peer's; the enterprise owner refuses per organization, and
a core caller never re-checks entitlement first. A licence, signature or flag adapter lives in the
enterprise module that holds the gate. A peer may be enterprise: model provider asks `ManagedProviderApi`, naming the project's
organization itself, so managed-provider holds no project peer (§3.3).

## Peer cycles (§5)

Today the container hands every `*Api` a proxy before install, so two modules naming each other
boot. The rule is still refusal. `pnpm lint:architecture --policies peer-cycles` lists every
declared edge whose peer reaches back (258 findings on 2026-10-05); the list that held them is
deleted, so the ratchet test stays red until none remain. `dev/docs/plans/peer-cycles-2026-10-05.md`
maps the back edges.

Before touching an edge: **ask Alex.** Ruled cuts so far: `secret -> project`, `gateway -> webhook`,
and workflow dropping `ProjectApi` and `OrganizationApi`. Everything else waits.

A cut is made from the reactor's side (§5, §9): the module being told reacts to the other's event
and the teller drops its peer. The reactor declares `.withPeerSubscriber(name, { eventType, data,
handle })` on its own pipeline, naming the event by the owner contract's type and schema, so its
one edge is that contract. The handler is idempotent and throws to be retried. Where reacting would
itself close a cycle, a scheduled process manager pulls instead.

### Worked example: `secret -> project` (cut 2026-10-05)

1. The policy reported `secret depends on project's Api, and project reaches back`.
2. Alex ruled the cut (§5). The plan named the only use: `getWithTeam` in `getAttributedUserId`.
3. An existing operation answers it, so no new `*Api` operation: `AuthzApi.getScope({ projectId })`,
   as `modules/api-key/process/src/services/run-key-mint.service.ts:76` already did.
4. `modules/secret/process/src/app/secret.app.ts:42` became `{ permissions: AuthzApi }`; the
   service takes `Pick<AuthzApi, "getScope" | "listTeamMemberBindings">`
   (`modules/secret/process/src/services/secret.service.ts:35`).
5. Doubles and the installation test (`secret-installation.unit.test.ts`) dropped the project peer;
   the policy re-run showed the edges gone.

The reversed shape is `gateway -> webhook`: gateway's spend event types and schemas live in
`modules/gateway/contract/src/gateway.spend-events.ts`, and webhook declares six peer subscribers
in `modules/webhook/process/src/eventing/webhook-delivery.pipeline.ts:68`. Gateway holds no
`WebhookApi`.

## Traps

- **A new `*Api` operation is a design choice.** Look for an existing one (secret used authz's
  `getScope`). If none answers, propose the operation with options; do not write it.
- **A cut leaves stale tests.** The worker installation test still asserted gateway's own webhook
  subscriber after the cut (`apps/worker/src/__tests__/worker-installation.integration.test.ts:292`
  now reads webhook's peer subscribers). After a cut, search every `*-installation.*.test.ts` and
  `apps/*/src/__tests__` for the old subscriber, peer key and fixture.
- **Generalising the gateway cut.** §9 says a delivery is not a reaction: a producer calls a
  destination's `requestDelivery` (ADR-167). `gateway -> webhook` was ruled by name; another
  delivery edge is a question for Alex, not a precedent to copy.
- **Dropping the token but still reaching the module.** Importing its services, repositories or
  tables instead is a violation even when the import resolves (CLAUDE.md rule 1).
- **Copying a module class you find in the tree.** Some still carry deleted statics (§15);
  check §15 before copying a spelling.

## Known disagreements (report, do not fix)

- `dev/docs/plans/peer-cycles-2026-10-05.md` still names a shrink-only edge list; §5 deleted it.

## Links

`dev/docs/ARCHITECTURE.md` §3.3, §3.5, §5, §6, §9, §11, §15, §16 · `dev/docs/lint-rules.md` ·
`packages/architecture-enforcer/src/policies/index.ts` · skills `architecture-guide`, `linting`,
`process-composition` (boot, config parse, secrets), `eventing-and-worker`, `contract`,
`process-module`, `testing`.
