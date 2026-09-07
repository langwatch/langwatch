# ADR-129: better-auth is a boundary over identity services

**Date:** 2026-08-28

**Status:** Proposed

**Builds on:** [ADR-115](115-identity-ships-as-packages.md) — identity ships as
two packages and the app has ONE composition root. This ADR applies the same
discipline to the part of the app ADR-115 left alone: the better-auth wiring,
the auth routers and the auth route, which together are the boundary that
turns a request into a call on an identity service.

**Related:** [ADR-045](045-domain-errors-handled-boundary.md) (a boundary
serialises a `HandledError`, it does not rebuild one),
[ADR-116](116-account-linkage-is-event-truth.md) (the storage adapter's two
branches), [ADR-117](117-identifier-first-front-door.md) (the front door the
boundary serves), [ADR-127](127-an-identifier-is-an-aggregate.md),
`dev/docs/best_practices/repository-service.md`.

> The ADR number is free as of 2026-08-28 on main and in every open PR
> (#7648 holds 128). A crowded range: check again before merging.

## Context

The identity platform is, on paper, already the house shape. Under
`app-layer/identity/` there are 32 repositories with `constructor(prisma)`,
16 services with constructor-injected ports, 5 event-ledger writers and some
25 adapter classes; `runtime.ts` composes them and the routers call what it
hands out. The packages behind it (`@langwatch/identity`,
`@langwatch/identity-server`) declare the ports and ship the services and
read neither Prisma nor the environment, and a test proves it.

The layer ABOVE that is not the house shape, and it is where the bugs of the
last bug bash were found and fixed one at a time:

```
 what better-auth/ looks like today

   index.ts (1,020 lines)                 hooks.ts (1,016 lines)
   ┌───────────────────────────────┐      ┌──────────────────────────────┐
   │ betterAuth({                  │      │ export async function        │
   │   plugins: [ ..inline.. ],    │      │   beforeUserCreate({prisma}) │
   │   secondaryStorage: {..redis} │      │   afterUserCreate({prisma})  │
   │   emailAndPassword: {         │      │   beforeAccountCreate({..})  │
   │     sendResetPassword: λ,     │──────▶   afterAccountCreate({..})   │
   │     onPasswordReset: λ,       │prisma│   afterAccountUpdate({..})   │
   │   },                          │  ×13 │   beforeSessionCreate({..})  │
   │   databaseHooks: { 9 × λ },   │      │   afterSessionCreate({..})   │
   │   hooks: { before: λ, after } │      │   legacy SSO callbacks       │
   │ })                            │      │                              │
   └───────────────────────────────┘      │        15 × prisma.*         │
              │                           └──────────────────────────────┘
              │ import { prisma } from "~/server/db"
              ▼
   passkey-signup.ts   sign-up-confirmation.ts   registeredIssuers.ts
   bornFinalizedOptIn.ts   last-way-in.ts   revokeSessions.ts (×3 copies)
```

Concretely, the inventory that preceded this decision found:

- Six modules under `better-auth/` import the `prisma` singleton at module
  scope; `index.ts` hands it into thirteen inline callbacks; `hooks.ts`
  spells fifteen queries. Seven of the eight tests that mock `~/server/db`
  live in this directory, because that is the only way to test a module that
  opens the database itself.
- The same question is asked in several places, each with its own answer. A
  case-insensitive user-by-email lookup exists seven times (four of them
  carrying the same explanatory comment). "Which organization owns this
  legacy SSO domain" exists four times. Session revocation exists five times,
  three of them in one file and one hand-written in the logout route, each
  spelling the `better-auth:active-sessions-` cache key on its own. Session
  minting exists twice with two identical structural context types.
- `routers/user.ts` writes password hashes into `Account` rows at three sites
  and answers "is this the last way in" with its own query, beside the module
  that exists to answer it.
- `runtime.ts` had two satellite composition roots (`two-step-runtime.ts` and
  `identity-lookup-runtime.ts`) next to it during this migration.
- Five ledger writers carry ~1,170 lines of the same stage → append → wait
  machinery, each with its own copy of the lazy App-handle loop.

None of this is a design that somebody chose. It is what a framework
integration looks like after every feature added one more lambda where the
framework offered a slot. The cost is the one the bug bash paid: a passkey
registered while signed in read the wrong branch because two modules answered
"who is this" differently; a confirmation link could not open a session
because the code that could was somewhere else; a reset-then-sign-in hit a
rate limit tuned in a file nobody associated with sign-in.

## Decision

We will make the whole of `better-auth/` — plugins, database hooks, request
hooks and configuration — a **boundary tier of classes over identity
services**, in the same shape the routers already take, and we will enforce
the tiers with a test the way ADR-115 enforces the packages.

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ BOUNDARY    better-auth/  ·  api/routers/{auth,user}.ts  ·  routes/auth │
 │             classes; constructor-injected SERVICES; never a client;    │
 │             translates the framework's shape, decides nothing about    │
 │             the data                                                   │
 ├────────────────────────────────────────────────────────────────────────┤
 │ SERVICES    app-layer/identity/*.service.ts, ledgers, ceremonies       │
 │             take repositories and ports; the business rule lives here  │
 ├────────────────────────────────────────────────────────────────────────┤
 │ REPOSITORY  app-layer/identity/repositories/**, *.adapter.ts,          │
 │ TIER        *-adapters.ts — the ONLY files that spell `prisma.` or the │
 │             Redis key scheme; one implementation per question          │
 ├────────────────────────────────────────────────────────────────────────┤
 │ COMPOSITION app-layer/identity/runtime.ts — the one root (ADR-115 §4); │
 │             the only file that says `new`                              │
 └────────────────────────────────────────────────────────────────────────┘
        requests come in at the top; `import` arrows only point down
```

Five rules, each a scenario in
`specs/identity/identity-service-layering.feature` and each a graph fact
`src/server/__tests__/identity-service-layering.unit.test.ts` walks:

The first migration lands these as ratchets. Existing Auth0/SSO callbacks in
`hooks.ts`, their `index.ts` Prisma hand-off, the existing sign-in shadow
adapter, and the main-branch SSO backoffice service are named residuals. They
remain so existing SSO customers keep signing in while the connection cutover
is developed separately; the test refuses any new residual and fails when a
named one disappears without its allowlist being tightened.

1. **better-auth moves off direct database access.** No new module under
   `server/better-auth/` imports `~/server/db` or a Prisma client for its
   value. What a hook or plugin needs, it is given.
2. **Prisma moves into the repository tier.** In
   `app-layer/identity/` and `better-auth/`, a query (`prisma.<model>.`,
   `prisma.$transaction`) appears only in `repositories/**`, `*.repository.ts`,
   `*.adapter.ts` and `*-adapters.ts`. `runtime.ts` may *hold* the client to
   construct repositories; it may not query with it. The auth routers and the
   auth route touch no `account`, `session`, `passkey`, `verification`,
   `ssoProvider` or `ssoConnection` row directly.
3. **The identity services are composed in one file.** `new <Service>(`,
   `new Prisma<…>Repository(` and `new <…>LedgerWriter(` occur in
   `runtime.ts` and nowhere else under the two trees. The three satellite
   runtimes fold into it. The App's `presets.ts` keeps composing the
   pipeline's repositories, as it does for every other domain.
4. **A question moves to one place.** Outside the named compatibility
   residuals and the repository tier, nothing
   in the identity trees, the auth routers, the auth route or
   `server/users/` spells a case-insensitive email match, an
   organization-by-legacy-`ssoDomain` lookup, or the `active-sessions-`
   session-cache key. Each has one repository method, and consumers ask it.
5. **better-auth keeps no state of its own.** No module-scope `let` under
   `better-auth/`. A cache is a field on the class that owns it (registered
   issuers); a counter is a field on the storage class that increments it; a
   value carried across a request is an `AsyncLocalStorage` owned by one
   class with `run` and `read` methods.

The shapes that follow from the rules:

- **Core database hooks** are grouped behind `config/database-hooks.ts` and
  delegate to identity services. The legacy Auth0/SSO callbacks remain in
  `hooks.ts` for this migration and are bound explicitly in `index.ts`; moving
  those security-sensitive decisions belongs to the connection cutover.
- **Plugins and guards** (`passkey-signup`, `sign-up-confirmation`,
  `password-reset-session`, `registeredIssuers`, `bornFinalizedOptIn`,
  `last-way-in`) become classes constructed in `runtime.ts` with the
  services they need. Their module exports keep their names, so `index.ts`
  and `routes/auth.ts` keep their imports while the internals change.
- **Session minting** — `findUserById` → `createSession` → `setSessionCookie`
  — is one class, `BetterAuthSessionMinter`, used by the confirmation
  endpoint and the reset after-hook. **Session revocation** — Postgres rows
  plus the Redis cache and its index — is one service,
  `SessionRevocationService`, over one repository that owns the key scheme;
  `revokeSessions.ts` and the logout route's private copy are deleted.
- **Credential accounts** — set password, change password, list and unlink
  linked accounts, the last-way-in check — are `CredentialAccountService` over
  `PrismaCredentialAccountRepository`. `routers/user.ts` calls it and never
  again writes a hash.
- **`index.ts`** becomes an assembly of ~100 lines over `better-auth/config/`
  modules (`plugins`, `secondary-storage` as a `RedisSecondaryStorage` class,
  `models`, `email-and-password`, `rate-limit`, `database-hooks`,
  `request-hooks`), each a function of the dependencies it is handed.
- **The five ledger writers** share a `StagedLedgerWriter` base that owns the
  lazy App-handle resolution, the stage, the optional waited append and the
  bounded read-your-writes wait; each writer keeps only what is its own (the
  command → sender-name table, whether it waits).

What does NOT change: the packages and their boundaries (ADR-115), the
event-sourced ledgers' semantics, the storage adapter's two branches
(ADR-116 — its removal is Phase 3 there, not here), the factory-function
API of `runtime.ts` that nine routers and five tests already use, and any
user-visible behaviour — especially legacy Auth0/SSO sign-in and auto-join.
This is a refactor; every existing scenario that was green stays green.

## Rationale / Trade-offs

We considered moving the legacy callbacks in the same change. That would make
the boundary cleaner, but it would also combine the account/session refactor
with a new SSO admission path. Keeping the current callbacks unchanged makes
compatibility reviewable; the ratchet prevents their exception from spreading.

We considered putting the identity services on the App (`getApp().identity`)
as the permissions and authz services are. It is the house pattern and it
may come later, but `betterAuth()` builds its adapter at module load, before
an App exists, which is why `runtime.ts` composes lazily and why its ledgers
resolve the pipeline handle on first use. Re-homing the root is a separate
decision with its own boot-order consequences; taking it inside a refactor
whose promise is "no behaviour changes" would break that promise in the
least visible place. The rules above are written so that a later App-slice
move changes only `runtime.ts`.

We considered renaming every `*-adapters.ts` file into `repositories/` to
make rule 2 a single directory. The adapters implement ports declared by
the services beside them, and their names say so; moving twenty-five classes
for a regex's convenience buys nothing a reviewer needs. Rule 2 names the
three suffixes instead.

The trade-off accepted is churn in the auth PR: the refactor lands as
commits on the same branch as the front door, because that branch is where
most of these files were written and a separate PR would conflict with
itself. Reviewers get a larger diff whose second half is mechanical; the
guard test is what makes the mechanical half checkable.

## Consequences

- A new core hook, plugin or guard is composed in `runtime.ts` and tested by
  handing it fakes. The named legacy callback exception cannot spread.
- A lookup exists once. When the case-insensitive email rule changes (or the
  legacy `ssoDomain` column finally goes), it changes in one repository
  method, and the guard test is what says nobody re-spelled it elsewhere.
- `index.ts` reads as a table of contents for the core configuration, with the
  legacy SSO callback hand-off visible as a named compatibility seam.
- `routers/user.ts` shrinks by the account-management code and stops being
  the place a credential is written by hand; the storage adapter and the
  ceremonies (ADR-116) become the only writers of `Account` rows, which is
  what ADR-116 wanted and could not yet say.
- The guard test lists offenders by file, so the rule can be tightened later
  (an App slice, the ADR-116 Phase 3 removal) by editing one regex and
  reading the list.

## References

- Related ADRs: ADR-045, ADR-115, ADR-116, ADR-117, ADR-127
- Spec: `specs/identity/identity-service-layering.feature`
- Guard: `platform/app/src/server/__tests__/identity-service-layering.unit.test.ts`
- Pattern: `dev/docs/best_practices/repository-service.md`
