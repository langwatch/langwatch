# @langwatch/authz

The unified authorization engine ([ADR-092](../../dev/docs/adr/092-unified-authorization-engine.md)).
This package is the **pure half** of the design: the permission registry, the
built-in roles, the `decide()` walk, and the witness/passport primitives. It
reads nothing and writes nothing - no Prisma, no env, no server imports - so
the client (`useCan`), the app's server adapters, and any future service can
all depend on it and get the same answer.

The **storage half** lives in the app at `platform/app/src/server/authz/`:
the collector (the one place authz data is read from Postgres), the epoch
cache, `GrantsService` (the one write surface), shadow mode, and the tRPC
middleware. They feed `CollectedGrants` snapshots in; everything here is a
deterministic function of that snapshot.

```
 PERMISSION   "traces:view"             a verb on a resource, from ONE registry
 ROLE         viewer ⊂ member ⊂ admin   a named set of permissions
 ROLE BINDING (WHO, ROLE, WHERE)        the only grant primitive

 WHO    user | group | api key                     WHERE   organization
 walk   COLLECT → FILTER (scope chain) → EXPAND            └─ team
        → UNION → DECIDE → RECORD                              └─ project
                                                                  └─ resource (trace, thread)
 Grants are an additive union. Narrowing = granting less, never overriding.
```

```
 app / client                      @langwatch/authz (this package)
 ──────────────                    ─────────────────────────────────
 collector.ts  ── CollectedGrants ──►  decide() ──► AuthzDecision
 cache.ts      ── ResourceGrant[] ──►  explain()      │ allowed · via
 grants.ts (writes, epoch bump)        registry       │ denialReason
 shadow.ts (legacy comparison)         roles          │ audience
 trpc-middleware (.permission())       witness ◄──────┘
 useCan / RequireCan (client)          passport + bitset (stage F)
```

## Bible of terms

Use these words exactly; every synonym that predates ADR-092 maps onto one of
them, and the migration deletes the synonyms.

| Term | Meaning |
|---|---|
| **Permission** | A `resource:action` string, e.g. `traces:view`. Comes from the one registry; nothing else may invent one. The registry order is **append-only** because bitset indices are derived from it. |
| **Resource** | A noun the registry declares: its supported actions, the scopes it can be granted at, and what `manage` implies for it. `traces:rotate` is a type error, not a runtime surprise. |
| **Action** | The verb half of a permission. `manage` satisfies the resource's other actions through the hierarchy rule (`permissionSatisfiedBy`). |
| **Registry** | `AUTHZ_RESOURCES` in `registry.ts` - the single authoritative vocabulary. Everything else (types, validators, bitset indices, pickers) is derived from it. |
| **Role** | A named set of permissions. Built-ins are declared as differences: viewer is the base, member = viewer + additions, admin = member + additions. Custom roles are permission lists stored per organization. |
| **Role binding** | `(WHO, ROLE, WHERE)` - the **only** grant primitive. Every "member of", "collaborator on", "key scoped to" is a binding. |
| **Principal (WHO)** | Who holds the binding: a user, a group, or an API key. At decide time there is also `anonymous` - a caller with no session, resolvable only through the resource tier. |
| **Scope (WHERE)** | Where a grant applies: organization → team → project → resource. A scope ref carries its lineage (a project knows its team and organization) - derived from the database, never from the request. |
| **Scope chain** | The binding scopes that can grant at a given scope, most specific first. A project check consults PROJECT, TEAM, then ORGANIZATION bindings. |
| **Additive union** | Grant semantics: bindings only ever ADD permissions. There is no override and no precedence; giving someone less means granting less. |
| **CollectedGrants** | The snapshot the collector produces for one (principal, organization): org membership, bindings (group-expanded), legacy team rows, custom-role permission lists. Everything `decide()` knows. |
| **The walk / `decide()`** | The six ordered steps: COLLECT → FILTER (scope chain) → EXPAND (roles → permissions) → UNION → DECIDE → RECORD. The order is the contract; the code reads top to bottom in `engine.ts`. |
| **Decision** | `AuthzDecision`: `allowed`, the permission and scope asked about, `via` (which step granted), `denialReason` (which gate denied), and `audience`. |
| **`via`** | The step that granted: `binding`, `org-role-floor`, `demo-project`, `legacy-team-fallback`, or `resource-grant`. |
| **Denial reason** | `no-membership`, `no-binding`, `lite-member-restricted`, or `owner-ceiling`. Stable vocabulary - the UI and error mappers key on it, never on message prose. |
| **Audience (decision)** | `member` or `public`. Serializers redact on `public` - a share-link viewer never sees member-only fields. |
| **Resource grant** | A grant at the resource tier: `(kind, id, projectId, permission, audience)`. One grant on a trace covers its spans, logs and metrics through the chain walk - children never get rows. |
| **Grant audience** | Who a resource grant is for: a user, group, or API key; members of a project, team, or organization; or `anyone` (the public share expressed as a row). |
| **Possession** | A share link authorizes only when its secret token is **presented**. Row existence never grants - that is what keeps trace-id guessing closed (ADR-057). |
| **Owner ceiling** | `effective(key) = grants(key) ∩ grants(owner)`, evaluated live. A key never outgrows or outlives its owner's access. Service keys (no owner) have no ceiling. |
| **Lite member** | Today: the `EXTERNAL` organization role, which caps team/project bindings at the lite-member bag. Stage C makes it a plain role with its own grants instead of a cross-cutting cap. |
| **Org-role floor** | Every organization member holds the org-member bag on organization-scope checks, bindings or not. A tagged legacy quirk. |
| **LEGACY-QUIRK(stage)** | A deliberately reproduced legacy behaviour, tagged with the migration stage that deletes it. Stage-A parity means matching legacy warts and all. |
| **Witness** | `Authorized<Scope>` - a branded, unforgeable proof that `require_()` allowed a permission at a scope. Repositories that accept a witness instead of a raw id make "forgot the check" fail to compile. |
| **Passport** | A signed, short-TTL (≤60s), epoch-bound token carrying per-scope permission bitsets. Lets stateless surfaces (Go gateway, collectors) verify with an HMAC check and an epoch compare - zero database. |
| **Bitset** | An effective permission set as bits indexed by registry order. The reason the registry is append-only: an index, once shipped inside a passport, must never change meaning. |
| **Epoch** | A per-organization counter. Every grant write bumps it; caches and passports are valid only for the epoch they were built under, so revocation lands on the next request. |
| **Shadow mode** | `AUTHZ_V2_SHADOW`: the engine runs beside the legacy resolvers on real traffic and logs mismatches with both verdicts. It never affects the response. |
| **Divergence family** | A classified, *expected* shadow mismatch: `external-cap` (the legacy API-key path applies no lite-member cap) and `ceiling-legacy-fallback` (the legacy key ceiling consults TeamUser rows un-gated). Dashboards partition on these so real bugs stand out. |

## Migration, in one screen

Full detail: [ADR-092 §13](../../dev/docs/adr/092-unified-authorization-engine.md)
and the [delivery plan](../../../adr-092-authz-delivery-plan.md) (stages,
gates, rollbacks, and the data runbook). The shape:

```
 A  EXTRACT    this package + adapters, parity suites, SHADOW mode   [shipped]
 B  BACKFILL   TeamUser → role bindings, then delete the fallback
 C  UNIFY      lite member becomes a role; ShareLink → resource grants (C5)
 D  ADOPT      .permission() everywhere; writes through GrantsService
 E  ENFORCE    every endpoint declares access or opts out, build-gated
 F  SCALE      epoch cache on, passports for stateless surfaces
```

Data that actually moves (runbook M1-M7 in the delivery plan): the TeamUser
backfill with a per-user parity sweep (M1-M2), legacy API-key re-keying behind
`AUTHZ_LEGACY_KEY_ENFORCE` (M3-M4), extending ShareLink into full resource-grant
storage - no parallel table, no backfill (M5), deriving then deleting the
legacy vocabulary in `rbac.ts` (M6), and the epoch discipline: every grant
write path must bump the epoch **before** `AUTHZ_EPOCH_CACHE` ever ships on
(M7). Every step is expand → dual-run → verify → cut over → delete, one flag
per cutover.

## Flags (read by the app adapters, not this package)

```
 AUTHZ_V2_SHADOW        0 | 1 | 0.0-1.0   shadow-comparison sample rate (default off)
 AUTHZ_EPOCH_CACHE      0 | 1             L1 grants cache (default off = always collect)
 AUTHZ_PASSPORT_SECRET  hex               enables passport minting (unset = disabled)
```
