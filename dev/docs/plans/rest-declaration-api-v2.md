# The REST declaration API, v2

Status: proposal. Design-only lane, 2026-09-17. No production code changed by
this document.

This is an **ergonomics and truthfulness** redesign of how a route is declared.
It is not a behaviour redesign. Everything in
`.claude/coordinator/ARCHITECTURE-LAW.md`'s transport section is settled and
stays settled — see [§7, What does not change](#7-what-does-not-change) — and
this proposal is written to make that law *easier to obey and harder to lie
about*, not to reopen it.

**Four rulings shaped it** (user, 2026-09-17), and the document is written to
them rather than around them:

1. **The builder stays.** An earlier draft of §3.4 proposed object literals; that
   is withdrawn. What the literals were really buying — an end to the 296 lines
   of restated type parameters — is bought inside the builder instead, by a
   single `RouteShape` parameter, and the chain keeps the `this:`-constraints a
   literal could not express. The ruling also makes the migration cheaper: no
   file changes shape, and ~1,900 call sites never move.
2. **Scope is the organising word** (§3.1). The type system already agreed: the
   four handler shapes differ only in what they say about scope, and the
   permission changes no type at all.
3. **A tenant id in the payload gets an explicit yes or no** (§3.6), the *yes*
   being the check itself and the correspondence running both ways. A half-built
   version of the *yes* exists: it throws a 500 rather than refusing at compile
   time, does not cover `userId`, and is defeated by snake_case. Nothing exists
   for the *no*. This is the finding most worth acting on before anything here is
   built.
4. **Delete the old way; fix the findings** (§5.3). No transitional coexistence:
   each slice deletes exactly one legacy spelling and drives that spelling's
   compile errors to zero before it stops. The compiler owns the worklist — it is
   exhaustive where a codemod only guesses — and the codemod becomes the
   accelerant. This is decision 17 carried one step further: not even a
   transitional alias.

---

## 1. The census

Numbers are from the working tree at 2026-09-17, over
`modules/**` + `enterprise/modules/**` (every REST family in the repository
lives there; `apps/` and `packages/` declare none).

| Thing | Count |
| --- | --- |
| REST families (`defineRestRouter`) | **92 files** |
| REST routes (`.handle(`) | **387** |
| tRPC families (`defineTrpcRouter`) | 163 files |
| tRPC procedures | 628 |
| Builder calls between the verb and `.handle()` | mean **4.68**, max 7, min 2 |
| `.withPermission(...)` | **272 routes (70%)** |
| `.withAccess(...)` | **115 routes (30%)** |
| `.withRawResponse(...)` | **108 routes (28%)** |
| `.withRateLimit(...)` in production | **0** |
| `defineRestMiddleware(...)` tokens | **53** |
| — of those, re-declared in `apps/api/src/app-rest/api-rest.host.ts` | **10** |
| `jsonResponse(...)` in transports | 25 calls across 5 files |
| `rateLimitedResponse(...)` in transports | 4 calls across 2 files |
| Reasons written as a SCREAMING const | **64 references / 23 consts** |
| Reasons written inline | **4** |
| Routes with `:projectId` in the path | **24** |
| Routes with `:userId` / `:User` in the path (no guard covers these) | **6 / 3** |
| Snake_case scope keys in module contracts (`project_id`, `user_id`, …) | **43** |

Per-route builder call histogram: `.withDocs` 343, `.withPermission` 272,
`.withOutput` 254, `.withParams` 208, `.withMiddleware` 168, `.withInput` 117,
`.withAccess` 115, `.withRawResponse` 108, `.withQuery` 57, `.withBodyLimit` 53,
`.withRawBody` 50, `.withStatus` 35, `.responds` 14, `.withCredential` 5,
`.withIdempotency` 5, `.anyMethod` 4, `.methods` 3, `.withAudit` 2.

Access kinds, as declared: `publicRoute` **34**, `anyAuthenticated` **21**,
`deferredScope` **8**, `optionalCredential` **1**.

Raw-response `produces`, as declared: `application/json` in **at least 55** of
the 108 (counting the `JSON_MEDIA_TYPE` / `PRODUCES_JSON` / `SCIM_ANSWER` /
`DISCOVERY_ANSWER` / `AUTH_ANSWER` consts); genuinely non-JSON bytes in **8**
(`image/*`, `*/*`, `text/csv`, `text/event-stream`, `application/octet-stream`,
`text/plain`, and two mixed HTML/JSON). **The raw hatch is overwhelmingly used
to escape the JSON path, not to serve bytes.**

Family-level declarations: `.withCredential` 28 (`organization` 11, `project` 5,
`internalSecret` 5, `browser` 5, `scimToken` 1, `instance-admin` 1),
`.withAddressing` 51 (`literal` 40, `v1-only` 5, `v1-in-path` 4, `dated` 2).

The transport conveyor (30 `transport-check-*` handoffs in `.claude/handoffs/`)
found most module transports already law-compliant. `RestErrorHandler` appears
88 times in those handoffs and is almost always a "not present, confirmed".
What the conveyor left standing, by its own words, is concentrated: the raw
doors, the four `*-legacy.rest.ts` families, `project.rest.ts`'s legacy
`HttpError` pattern, and a handful of protocol endpoints (SCIM, OAuth device
flow, MCP).

`declaration.ts` itself: **1,998 lines**, **26 builder methods**, and **296
lines** (15% of the file) that are nothing but the 13-entry type-parameter list
restated once per method return type.

---

## 2. The four charges — and a fifth the census found

### 2.1 Two access vocabularies — and a missing word

`.withPermission(p)` and `.withAccess(kind)` are mutually exclusive halves of
one question. `handle()` refuses a route that declares neither
(`declaration.ts:1670`), which is a runtime assert standing in for a type.

The `user-avatar.rest.ts` mis-declaration the user flagged is not carelessness.
The vocabulary has **no true word** for what that route is. Read
`declaration.ts:164-208`:

- `anyAuthenticated` resolves to `ScopedHandlerArguments`, which hands the
  handler `scope: DoorScope<Door>`. The avatar family's door is `browser`, and
  `DOOR_SCOPE_TIER.browser === "project"` — so `anyAuthenticated` *promises the
  handler a project scope*. A `<img src>` fired with a session cookie and no
  project context cannot supply one.
- `deferredScope` resolves to `DeferredHandlerArguments`: `actor` present,
  `scope: null`, and the **whole `Api` still handed over**.

So the route wanted "any authenticated caller, and this door resolves no
scope". That combination is unspellable, and `deferredScope` was the only kind
that yields `scope: null`. It borrowed a word that names a debt it never pays,
and the prose beside it tells the truth the declaration cannot.

The deeper defect: the five kinds weld together **two independent axes** —
*which credential opens the door* and *which scope the handler is handed* —
and expose only five of the combinations.

Nothing checks the deferral is discharged. `DeferredHandlerArguments` is
`ScopedHandlerArguments` with `scope` nulled; an undischarged deferral
typechecks perfectly.

### 2.2 String-keyed middleware tokens

`defineRestMiddleware(name, schema)` returns `{ name, schema }`
(`request.ts:887`). The runtime matches bindings to declarations through
`new Map(facts.map((b) => [b.middleware.name, b]))` (`runtime.ts:413`) — a
**string** map. Consequences the census can see:

- **10 of the 53 tokens are declared twice.** `apps/api/src/app-rest/api-rest.host.ts`
  lines 64, 74, 80, 94, 107, 113, 119, 125, 131, 140 each re-declare a token
  the owning module already exports, with a **hand-retyped schema**. For
  `userAvatarCaller` the host writes
  `z.object({ apiKeyProjectId: z.string().nullable(), userId: z.string().nullable() })`
  while `modules/user/contract/src/user-rest.schemas.ts:98` declares the same
  shape as `userAvatarCallerSchema`. The module's exported token
  (`modules/user/server/src/index.ts:3`) is never imported by the host. It works
  only because both objects carry the same string. This is
  `rest-schema-from-own-contract`'s exact violation, in a file that rule does
  not lint.
- **Name collisions are silent.** `"traceparent"` is declared by three separate
  token objects; `"surface"` by two. Two tokens with one string in one mount
  resolve last-writer-wins.
- **The const name and the key disagree** in a third of the declarations:
  `agentTraceparent` → `"traceparent"`, `suiteSurfaceFact` → `"suiteSurface"`.
- **Unbound is a runtime throw**, at mount, in `factBindings` — found only when
  that mount is exercised.

### 2.3 Escape-hatch soup on the byte doors

Two genuine byte doors exist: `user-avatar.rest.ts` (1 route) and
`stored-object-file.rest.ts` (2 routes). Between them they hand-roll:

- `rateLimitedResponse(resetAt)` ×4, emitting `{"error":"rate_limited"}` — a
  **different 429 body** from the canonical one, which is `RateLimitedError`
  (`errors.ts:115`, a `HandledError` with `code`, remediation and trace ids)
  serialised by the family's `onError`.
- `jsonResponse({...}, 404|502)` ×5, hand-built envelopes on doors whose thrown
  `HandledError`s already reach the canonical handler — proven in the same
  avatar handler by `UserAvatarNotFoundError`.
- `new HTTPException(500, ...)` for an impossible state that should be a plain
  `Error`.
- Per-door allowance ports (`countAvatarRead`, `countRead`) and a per-door
  `identify` port, duplicating what the door and the `RateLimiter` port do.

Meanwhile `.withRateLimit()` — the declared seam at `declaration.ts:665` over
the `RateLimiter` port — has **zero production adopters**. There is a real
reason, and the design must fix it: `runtime.ts:1056-1078` keys the counter on
`principalOf(caller)`, i.e. `caller.scope ?? actor`. A deferred byte door has
**no scope**, and its real principal is the dual credential that only a
*middleware fact* resolves — which the framework's key never sees. The declared
seam could not express the byte doors' key, so the byte doors wrote their own,
and the wire now carries two different 429s.

### 2.4 Verbosity, and reasons that drift

4.68 builder calls per route plus verb and `handle`, over 387 routes. The
family header adds 4 more.

The cost lands hardest in the framework, not at the call sites: **296 of
`declaration.ts`'s 1,998 lines are the 13-parameter type list restated**, once
per method per return type. Adding a 14th option is an O(methods) edit today,
and the file grows quadratically in options × methods. That is a property of
*thirteen positional type parameters*, not of the builder — §3.4 keeps the
builder and removes it.

At the call sites, the verbosity that is worth removing is the part that says
nothing: one question asked through two call names (§2.1), a raw hatch that does
not say which of three things it is (§3.5), and reasons that live somewhere else
(below).

Reasons: **64 of 68** access reasons are SCREAMING consts, drawn from 23
distinct consts — `GATEWAY_INTERNAL_GATE` serves 12 routes,
`BEARER_IS_THE_WHOLE_GATE` 12, `DOOR_REASON` 4. A reason written once and
pointed at from twelve routes is a reason that cannot be true of all twelve;
that is the drift mechanism, not an accident of naming.

### 2.5 Scope-bearing input that nothing verifies

Not one of the original four; the census turned it up while counting the others,
and it is the only charge with a possible security edge.

A route can take a `projectId`, `organizationId`, `teamId` or `userId` in its
path, query or body and never compare it to the caller. One guard exists —
`assertNoSensitiveScope` (`access/access.ts:533-549`) — and it is right in
intent, but it throws a plain `Error` (a customer-visible 500, at request time),
knows only the three tier fields, matches exact key strings, and runs only on the
`no-permission` declaration kind.

The measurable consequences: **`userId` is in no guard's set**, and **6 routes
take `:userId` in the path with 3 more taking `:User`**; module contracts declare
**43 snake_case scope keys** (`project_id` 28, `user_id` 7, `organization_id` 7,
`team_id` 1) that an exact-string guard cannot see.

§3.6 is the answer — an explicit yes or no per field, the yes being the check —
and §9 asks whether its detector should run ahead of the whole redesign.

---

## 3. The v2 shape

### 3.1 One access vocabulary, organised by scope

**Ruled by the user, 2026-09-17: the builder stays, and scope is the organising
word.** The second is the sharper call, and the type system already agrees with
it. `HandlerArgumentsFor` (`declaration.ts:209-220`) keys off the access *kind*
and the *door* — **never off the permission**:

| Handler shape | `actor` | `scope` | `app` |
| --- | --- | --- | --- |
| `ScopedHandlerArguments` | present | `DoorScope<Door>` | present |
| `OptionalHandlerArguments` | nullable | `DoorScope<Door> \| null` | present |
| `PublicHandlerArguments` | `null` | `null` | present |
| `DeferredHandlerArguments` | present | `null` | present *(and §3.2 removes it)* |

The four shapes differ **only in what they say about scope**. So:

> **The scope axis carries the entire type content of an access declaration.
> The grant axis is a value with no type consequence at all** — `"annotations:view"`
> and `"annotations:manage"` produce byte-identical handler types.

That is why `.withPermission(p)` could never have been the whole story, and why
the vocabulary should lead with the choice that has teeth. Scope first, grant
second:

```ts
// The 272-route common case: the door's own scope, so it goes without saying.
.withAccess("annotations:view")

// Scope names itself whenever it is not the door's own:
.withAccess((a) => a.holding("traces:view").checks("projectId"))
.withAccess((a) => a.scopeTheHandlerFinds(StoredObjectOwnerLookup)
                    .holding(["traces:view", "scenarios:view"])
                    .because("an object is addressed by its id, so the project that owns it is a read this handler makes"))

// No scope at all — and now the three no-scope openings read as one family:
.withAccess((a) => a.noScope().everyone().because("the liveness probe answers before a session exists"))
.withAccess((a) => a.noScope().anyCaller().because("any member may read any avatar; the door resolves no project"))
.withAccess((a) => a.noScope().callerIfAny().because("a shared link renders for signed-out readers too"))
```

Every escape now begins with `noScope()` or names the scope it uses, which is
exactly the question the avatar door got wrong. `.checks("projectId")` is §3.6's
verb doing double duty: it says *where* the permission is asked **and** discharges
the `projectId` the input carries, which is why there is no separate
`atPathScope`. **Both argument forms are ruled
in** (§8): the bare permission for the 272-route case, the callback for the
escapes. `.withPermission` is deleted, not aliased (decision 17).

**Why the call is `.withAccess` and not `.withScope`.** Scope is the right word
*inside* the builder and the wrong word *on* it. In this tree `scope` already
names the tenant identifier — `scopeId` 2,792 occurrences, `AuthzDeclaredScopeId`
217, `ScopeTierField` 145, plus `checkScopeLineage`, `BlankScopeIdError`,
`routeScopeOf`, and two UI pattern docs (`scope-selector-and-badges.md`,
`scoped-resources.md`). `.withScope("annotations:view")` would be plainly false:
that argument is a permission. `.withAccess` answers "who may open this door?",
which is the question, and `a.noScope()` answers "against which tenant?", which
is the type. **Ruled and settled** (§8, "names stand").

Why a callback rather than free constructors (`everyone({ because })`): the
vocabulary stays **closed and discoverable**. Typing `a.` lists exactly the
admissible scopes, and `.noScope().` exactly the openings that survive having no
tenant. There is no way to hand `.withAccess` a hand-rolled object — which is
precisely what today's free `publicRoute()` / `deferredScope()` constructors
allow.

Why this makes the wrong kind hard to write:

- **Scope is now an answer, not a consequence of the word you picked.** The
  avatar door is `a.noScope().anyCaller()` — a true sentence that exists in the
  vocabulary. Its prose stops disagreeing with its declaration.
- **`everyone()` is unmistakably public**, and sits under `noScope()` where it
  belongs. It is the only opening that hands the handler `actor: null`, and the
  only one the OpenAPI document publishes with no security requirement.
- **A reason is owed exactly where it is owed, and the type says so.** Each
  escape's terminal returns `AccessNeedingReason<…>`, which is *not* assignable
  to the `Access<…>` that `.withAccess` requires; only `.because(string)` returns
  one. So an unjustified escape does not compile. Today a blank reason **throws
  at runtime** (`access/access.ts:130`) — a runtime check standing in for a type.
  `a.holding(p)` at the door's scope needs no `.because`: the permission is its
  own justification. `scopeTheHandlerFinds(...)` does owe one, because a
  deferral is a debt.
- **A deferral is structurally discharged.** See §3.2.

Two runtime asserts in `assertRouteReady` (`declaration.ts:1670-1675`) — "must
declare withPermission() or withAccess()" and "declares both a permission and
`<kind>` access" — become unreachable: one call, one argument. The first is
already half-enforced by `RouteReady` making `handle` resolve to `never`, which
is where the infamous *"Expected 0 arguments, but got 1"* comes from; §3.4
replaces it with a named refusal type.

### 3.2 The deferral, made structural

A route declaring `a.scopeTheHandlerFinds(...)` gets handler arguments with
**no `app`, no `scope`, no `actor`**. It gets one value in their place:

```ts
type Deferred<Api, Before, Permissions extends AuthzPermission> = Readonly<{
  /** The small, named, cross-tenant surface the door may use before a scope exists. */
  readonly before: Before;
  /** Runs the declared permission at the scope the handler found, then opens the app. */
  at(
    scope: { projectId: string },
    permission: Permissions,
  ): Promise<{ app: Api; scope: ProjectScopeId; actor: AccessActor }>;
}>;
```

Three properties follow, and each fixes something the census found:

1. **An undischarged deferral cannot typecheck.** The handler has no `app` until
   `at(...)` returns one, so it cannot produce the declared answer. The avatar
   door could not have declared this kind; it would have had nothing to
   discharge with.
2. **The cross-tenant surface is declared and small.** Today a deferred route is
   handed the whole `Api` with no scope, and nothing marks which of its methods
   read across tenants. v2 makes the sliver the argument to
   `a.scopeTheHandlerFinds(StoredObjectOwnerLookup)`, so the pre-scope surface is
   reviewable in the declaration rather than discoverable by reading the handler.
3. **The permission set stays published.** `.holding([...])` keeps the
   files door's genuine "`traces:view` *or* `scenarios:view`, depending on what
   the object turns out to be" in the declaration, where OpenAPI and the route
   registry can read it, and `at(scope, permission)` picks one at runtime.

This is the hardest part of the migration (8 routes) and the only part that is
not mechanical. It is also the part that pays for the redesign.

### 3.3 Typed facts: the token is the identity

```ts
// modules/user/server/src/transport/user-avatar.rest.ts
export const avatarCaller = restFact(userAvatarCallerSchema);   // no string, anywhere
```

`restFact(schema)` returns a branded `RestFact<Schema>` carrying a fresh
`symbol` and the schema. A route names it with `.withFact(avatarCaller)` — the
renamed `.withMiddleware`, because "fact" is the word the rest of the system
already uses (`withTransportFacts`, `factBindings`, *"declares the fact"*) and
`.withMiddleware` is the odd one out. A supply is minted **from the token**:

```ts
// modules/user/server/src/user.server.ts
.withTransportFacts(() => [
  avatarCaller.suppliedBy((request) => dualCredentialOf(request)),
])
```

The runtime keys on the symbol, not the name. Consequences:

- **The host cannot re-declare a token.** To bind one you must import it, and
  importing it is the only way to name it. The 10 twins in `api-rest.host.ts`
  become 10 imports, and the 10 hand-retyped schemas delete — each is a copy of
  a schema the owning contract already exports.
- **Collisions become impossible** rather than silent. Three `"traceparent"`
  tokens are three distinct identities, which is what they always were.
- **Unbound becomes a compile refusal.** The router type accumulates the union
  of facts its routes name — `RestTransportDeclaration<Api, Facts>` — and
  `withTransportFacts` takes `SuppliesFor<Facts>`: an unsupplied member resolves
  to `MissingFact<"avatarCaller">`, mirroring the kernel's own `MissingSupply<…>`
  idiom (ARCHITECTURE-LAW, process supply). The mount-time throw in
  `factBindings` (`runtime.ts:413-427`) deletes.
- The fact's name for diagnostics comes from a debug label the token carries,
  not from an identity key: it may be wrong without anything breaking.

Cost: one new type parameter on `RestTransportDeclaration` and the router,
defaulted to `never`. The 34 files carrying an explicit
`RestTransportDeclaration<Api>` annotation need it widened; the other 58 infer.

### 3.4 The builder stays — with one type parameter instead of thirteen

**Ruled by the user: builder.** Object literals were the earlier draft's
recommendation and are withdrawn. The reason they were attractive was never the
literal syntax — it was the **296 lines of type-parameter restatement**
(§2.4). That is fixable inside the builder, and fixing it there is strictly
better, because the builder's `this:`-constraints are more expressive than the
conditional types a literal would need.

**The one change that matters.** Replace the 13 positional type parameters with
a single record:

```ts
// Today — restated in full on all 26 methods, 296 lines of it:
class RouteBuilder<Api, Method, Path, Params, Body, Query, Output,
                   Permission, Middleware, Access, Family, Door, StrictJsonSchemas> {
  withParams<Schema extends z.ZodObject>(schema: …):
    RouteBuilder<Api, Method, Path, Schema, Body, Query, Output,
                 Permission, Middleware, Access, Family, Door, StrictJsonSchemas> { … }
}

// v2 — one parameter carrying the same state, one line per return:
type RouteShape = {
  method: HttpMethod; path: string; params: RouteSource; body: RouteSource;
  query: RouteSource; answer: RouteAnswer; access: AccessState;
  facts: readonly RestFact[]; door: RestDoorCredential; strict: boolean;
};

class RouteBuilder<Api, S extends RouteShape> {
  withParams<Schema extends z.ZodObject>(schema: ExactPathSchema<S["path"], Schema>):
    RouteBuilder<Api, Set<S, "params", Schema>> { … }
}
```

Every existing conditional type keeps working verbatim, reading `S["params"]`
where it read the positional `Params`: `ExactPathSchema`, `DistinctSchema`,
`RouteReady`, `HasJsonDeclarations`, `JsonDeclarationsReady`, `OutputResultCheck`,
`ExactDeclaredOutput`, `HandlerArgumentsFor`, `RawBodyArguments`,
`MultipartArguments`, `RawResponseArguments`. Nothing about the type-state is
weakened; it is spelled once instead of 26 times.

| | Today | v2 |
| --- | --- | --- |
| Lines of type-parameter restatement | **296** | **~26** (one return type per method) |
| Cost of adding a 14th option | one field, then a 14-line edit × 26 methods | one field on `RouteShape`, one method |
| Growth in options × methods | quadratic | linear |

**What else the builder gets, that the literal was going to give:**

| Guarantee | Today | v2 |
| --- | --- | --- |
| `withInput` illegal on GET/HEAD | `this:` constraint excluding `get`/`head` | unchanged — and **better than a literal**, which can only omit a property, not explain why |
| Params schema matches the path's names exactly | `ExactPathSchema<Path, Schema>` | unchanged, reads `S["path"]` |
| Params/query/input mutually distinct | `DistinctSchema<A, B>` | unchanged |
| Handler result matches the declared answer exactly, excess keys refused | `OutputResultCheck` / `ExactDeclaredOutput` | unchanged |
| Raw/multipart/rawBody change the handler's arguments | three conditional types on `handle` | unchanged |
| Access declared before `handle` | `RouteReady` → `handle` resolves to `never` → *"Expected 0 arguments, but got 1"* | `handle(this: MissingDeclaration<"withAccess">)` — a **named** refusal, the kernel's `MissingSupply<…>` idiom |
| Both a permission *and* an access kind | runtime throw, `declaration.ts:1674` | unspellable: one call, one argument |
| A blank reason on an escape | runtime throw, `access/access.ts:130` | `AccessNeedingReason` is not an `Access` (§3.1) |
| Operation ids unique in a family | `assertRouteAvailable` runtime throw | **stays a runtime throw** — this is the one thing keyed object literals would have given for free |

That last row is the honest cost of the ruling, and it is small: a duplicate
operation id is caught on the first mount of the family, which every family's
own declaration test already performs.

**Reasons inline.** `.because("…")` is a chained call taking a string, so a
two-line justification sits at the call site without fighting the chain — which
is what pushed 64 of 68 reasons out into 23 shared SCREAMING consts. Nothing
structural forces inlining; §6 records an optional lint if the pattern returns
after the codemod.

### 3.5 Byte doors as a first-class kind

`withRawResponse` today conflates two different things: *"I serve bytes"* (8
routes) and *"I write my own JSON"* (~55 routes, plus the four
`*-legacy.rest.ts` families). v2 splits them into declared answer kinds:

```ts
.withBytes({ produces: "image/*" })                    // signed-URL redirect OR a stream
.withEventStream({ events: … })                        // SSE
.withProtocolBytes({ produces: […] }).because("…")     // the escape; a reason is required
```

Three named calls replace one `.withRawResponse`, so the declaration says which
of the three a route is. `.withBytes` is the decision-18 kind, and its handler
returns a **union**, because the same route does one or the other depending on
whether the store can sign:

```ts
.handle(async ({ input, deferred }) => {
  const { app } = await deferred.at({ projectId: owner.projectId }, "traces:view");
  const served = await app.readById({ projectId: owner.projectId, id: input.id });

  return served.signedUrl
    ? redirectTo(served.signedUrl, { expiresIn: 300 })
    : streamBytes(served.stream, { mediaType: served.mediaType, byteLength: served.byteLength });
})
```

The framework owns what both byte doors hand-roll identically today: the
readback media-type allowlist, `Content-Disposition` from a sanitised filename,
`STORED_OBJECT_RESPONSE_BASE_HEADERS`, `Content-Length`, and `Cache-Control`.
`modules/dataset` already presigns for uploads, so the signing port has
precedent in the tree.

**Rate limiting, built in.** The reason `.withRateLimit()` has no adopters is
that its key is `caller.scope ?? actor`, and a deferred byte door has neither.
The fix is one field on the existing call:

```ts
.withRateLimit({ requests: 240, seconds: 60, per: avatarCaller })
```

`per` names a **fact token**, so the framework derives the key from the
already-parsed fact — the exact key the byte doors compute by hand. With that,
`rateLimitedResponse` and `jsonResponse` stop being exported, the two
`countRead`-shaped app methods delete, and both doors answer the canonical
`RateLimitedError` 429 that every other route answers.

**Errors, built in.** Byte doors throw like everything else. The 5
`jsonResponse` calls become `StoredObjectNotFoundError` /
`StoredObjectUnavailableError` (codes in `app-codes.ts` with presentation
entries); the `HTTPException(500)` becomes a plain `Error`. The family's
`onError` already serialises both on the raw path — `UserAvatarNotFoundError`
proves it in the very handler that also hand-rolls a 502.

### 3.6 A tenant id in the payload gets an explicit yes or no

**Ruled by the user, 2026-09-17.** The question was whether a `projectId` /
`project_id` / `orgId` / `userId` in the payload must be verified automatically,
with a type-safe error when it cannot be; the answer sharpened it into a rule
worth stating on its own:

> If a project, user or organization is named in the payload, the route must say
> explicitly **"yes, we are authorising it"** or **"no"** — and the *yes* is the
> check itself, not a claim that something else performs it. And the same in
> reverse: claiming to authorise a field the payload does not carry is equally an
> error.

A half-built version of the *yes* already exists, which is the most useful thing
the census found; there is nothing at all for the *no*, and nothing for the
reverse direction.

`assertNoSensitiveScope` (`access/access.ts:533-549`) already walks the parsed
input and refuses a scope field the declaration did not individually allow:

```ts
for (const field of SCOPE_INPUT_FIELDS) {
  if (field in input && !allowed.includes(field)) {
    throw new Error(`${field} is not allowed to be used without permission check`);
  }
}
```

It is right in intent and leaks in four directions:

| Gap | Evidence |
| --- | --- |
| **It is a plain `Error`**, so a declaration hole surfaces to the customer as a 500 with a trace id, at request time, on the unlucky request that first exercises the route. | `access/access.ts:546` |
| **It only knows the three tier fields** — `SCOPE_INPUT_FIELDS` is `Object.values(SCOPE_TIER_FIELDS)` = `projectId`, `teamId`, `organizationId`. **`userId` is not in the set.** | `modules/authz/contract/src/vocabulary.ts:55-59`; **6 routes take `:userId` in the path and 3 take `:User`** — precisely the "a view with a user id and no permission" case |
| **It matches exact key strings**, so a differently-spelled field walks past. | Module contracts declare **`project_id` 28 times, `user_id` 7, `organization_id` 7, `team_id` 1** — 43 keys the guard cannot see |
| **It runs only on the `no-permission` declaration kind**, so it is not a general answer. | `assertNoSensitiveScope`'s parameter type |

v2 makes it a **compile** refusal, general, and spelling-proof.

**1. Normalise the key at the type level**, so spelling cannot dodge the check:

```ts
type Strip<S extends string, C extends string> =
  S extends `${infer H}${C}${infer T}` ? Strip<`${H}${T}`, C> : S;
type Normalize<K extends string> = Lowercase<Strip<K, "_">>;
// projectId | project_id | projectid | PROJECT_ID  →  "projectid"
```

**2. Widen the closed set, and classify it.** Two kinds of identifier, because
they are discharged differently:

- **Scope fields** — `projectid`, `organizationid`, `teamid`. A permission can be
  *checked* at one.
- **Ownership fields** — `userid`, and anything later added. No permission is
  checked at a user; it can only be *matched* against the caller.

**3. Every scope-bearing key gets an explicit yes or no, and the yes *is* the
check.** Not a promise that something else checks it — the declaration performs
it:

```ts
.withAccess((a) => a.holding("traces:view").checks("projectId"))

.withAccess((a) => a.holding("annotations:view").checks("userId"))

.withAccess((a) =>
  a.noScope().anyCaller().because("…")
   .doesNotCheck("projectId", { because: "a lookup key, not a gate — …" }))
```

`.checks(k)` needs no second word about *how*, because the closed set already
classifies `k` and the classification decides what checking means:

| Field kind | `.checks(k)` does | Today's equivalent |
| --- | --- | --- |
| **Scope** — `projectid`, `organizationid`, `teamid` | asks the declared permission at the scope `input[k]` names, not at the credential's own | `permissionTarget: { at: "route", param }` → `routeScopeOf` — **opt-in, and taken by ~10 routes** |
| **Ownership** — `userid` | refuses unless `input[k]` is the caller's own actor id | **nothing. There is no such check anywhere today.** |

So one verb covers both, and a route cannot pick the wrong kind of check for a
field — the field's name decides it, which is the same reasoning that already
makes `SCOPE_TIER_BY_FIELD` the source of a tier rather than a parameter
(`routeScopeOf`: *"the tier comes from the name, so a route cannot check a
project permission against a team id"*).

**The correspondence runs both ways.** The set of keys named across `.checks(...)`
and `.doesNotCheck(...)` must be **exactly** the set of scope-bearing keys in
`params ∪ query ∪ input` — no more, no fewer:

- a key in the input that the route never mentions →
  `UnverifiedScopeInput<"userId">`;
- a key the route mentions that is not in the input →
  `NoSuchInputField<"projectId">`.

The second half is the one that keeps the declaration honest over time. Without
it, a route that drops `projectId` from its schema keeps a `.checks("projectId")`
that now checks nothing, and reads — to a reviewer, and to the OpenAPI document —
as though it still does. **This exact bidirectional rule already exists in the
builder**: `ExactPathSchema<Path, Schema>` refuses a params schema whose keys are
not precisely the path's parameter names. §3.6 is that idea applied to the one
set of fields where getting it wrong is a tenancy bug rather than a 404.

`.scopeTheHandlerFinds(...)` (§3.2) is not a third answer to this question — it
is the case where there is **no** such key in the payload and the scope has to be
discovered. The files door's id-only URL is that; its `/:projectId/:id` twin
carries the key and says `.checks("projectId")`, which is what its handler
already does by hand when it refuses a foreign claim.

**4. The runtime guard stays** as the belt to the type's braces, reading the
normalised set, and its plain `Error` becomes a typed refusal so a hole is a
declaration bug rather than a customer-visible 500.

**What it costs, honestly.** This fires on routes that are correct today only by
convention — the handler uses `scope.id` and simply ignores the `input.projectId`
the path also carries. Those answer `.checks("projectId")`, which is strictly
better: today nothing stops a later edit from reading `input.projectId` instead,
and that edit is a cross-tenant read that no test would catch. The
affected set is bounded and countable: **24 routes with `:projectId` in the path,
6 with `:userId`, 3 with `:User`, plus the 43 snake_case keys in module
contracts.** §5.2 carries it as hand-port work, because each one is a sentence
about that field, not a rename.

---

## 4. The same routes, current and proposed

### 4.1 The avatar byte door — `modules/user/server/src/transport/user-avatar.rest.ts`

**Current** (declares `deferredScope`; its own prose describes `anyAuthenticated`):

```ts
const AVATAR_RATE_LIMIT_WINDOW_SECONDS = 60;
const AVATAR_RATE_LIMIT_MAX = 240;

export const userAvatarCaller = defineRestMiddleware("userAvatarCaller", userAvatarCallerSchema);

const OWNER_IS_IN_THE_PATH =
  "any authenticated caller may read any avatar, so the door authenticates and resolves no scope; " +
  "the object's purpose and owner kind are what gate the bytes";

export const userAvatarRest = defineRestRouter(UserApi)
  .withNamespace("user-avatar")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/user-avatar/:projectId/:id", "readUserAvatarBytes")
  .withParams(userAvatarRestParamsSchema)
  .withAccess(deferredScope({ reason: OWNER_IS_IN_THE_PATH }))
  .withMiddleware(userAvatarCaller)
  .withRawResponse({ produces: "image/*" })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input }, caller) => {
    const allowance = await app.countAvatarRead({ caller, windowSeconds: …, max: … });
    if (!allowance.allowed) return rateLimitedResponse(allowance.resetAt);

    let result: UserAvatarObjectRead;
    try {
      result = await app.readAvatarObject({ projectId: input.projectId, id: input.id });
    } catch {
      return jsonResponse({ error: "avatar temporarily unavailable" }, 502);
    }

    if (!isUserAvatar(result)) throw new UserAvatarNotFoundError(input.id);
    if (result.status === "missing") throw new UserAvatarNotFoundError(input.id);

    return avatarBytes(result);   // + a 12-line header-building helper
  })
  .build();
```

**Proposed:**

```ts
export const avatarCaller = restFact(userAvatarCallerSchema);

export const userAvatarRest = defineRestRouter(UserApi)
  .withNamespace("user-avatar")
  .withVersion(MANAGEMENT_API_VERSION)
  // The browser's own door: an <img> fires with a cookie; a project key opens the same one.
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/user-avatar/:projectId/:id", "readUserAvatarBytes")
  .withParams(userAvatarRestParamsSchema)
  .withAccess((a) =>
    a
      .noScope()
      .anyCaller()
      .because(
        "any authenticated caller may read any avatar, so the door authenticates and resolves " +
        "no project; the object's purpose and owner kind are what gate the bytes",
      )
      // §3.6: the path carries a projectId, so the route must answer yes or no.
      .doesNotCheck("projectId", {
        because:
          "a lookup key, not a gate — the read is keyed on (projectId, id), so a mismatched " +
          "project finds no row",
      }),
  )
  .withFact(avatarCaller)
  .withRateLimit({ requests: 240, seconds: 60, per: avatarCaller })
  .withBytes({ produces: "image/*" })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input }) => {
    const read = await app.readAvatarObject({ projectId: input.projectId, id: input.id });

    if (!isUserAvatar(read) || read.status === "missing") {
      throw new UserAvatarNotFoundError(input.id);
    }

    return read.signedUrl
      ? redirectTo(read.signedUrl, { expiresIn: 300 })
      : streamBytes(read.stream, {
          mediaType: read.metadata.mediaType,
          byteLength: read.metadata.byteLength,
          cache: "private, max-age=86400",
        });
  })
  .build();
```

One call longer than today (`.withRateLimit` earns its place), and the file loses
roughly 35 lines of machinery while gaining about 10 of written justification —
net **~25 lines shorter**, and the trade is the point: machinery out, argument in.

Deleted by the shape rather than by discipline: the two rate-limit consts, the
reason const, the `countAvatarRead` app method and its allowance branch,
`rateLimitedResponse`, `jsonResponse(…, 502)` (an unexpected store failure now
throws a plain `Error`, degrading to unknown + a trace id, which is what it is),
the 12-line `avatarBytes` header builder, and the string `"userAvatarCaller"` in
two files.

**And the declared access kind becomes true** — `noScope().anyCaller()` is the
sentence the route's own prose has been writing all along, now spellable.

This route is also the worked example of §3.6, and of why the **no** answer has
to exist. `userAvatarRestParamsSchema` is `{ projectId, id }`
(`modules/user/contract/src/user-rest.schemas.ts:106-109`), so the path carries a
project id that no permission is checked against. It is genuinely safe — the read
is keyed on the pair, so a wrong project finds no row — but **that argument is
made nowhere in the current file**, and nothing would notice if a later edit broke
it. Under v2 the route does not compile until it answers, and here the honest
answer is *no, and here is why*. A binary with only a *yes* would have forced this
route to invent a scope check it does not need; a *no* with a written reason gets
the argument onto the page, where review can see it. (§9, question 1.)

### 4.2 A CRUD family — `modules/annotation/server/src/transport/annotation.rest.ts`

**Current** (one of six routes; the file is 107 lines):

```ts
export const annotationRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AnnotationApi>;
}> = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/:id", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.getById({ id: input.id, projectId: scope.id });

    return { data: annotation };
  })
  // … five more
  .build();
```

**Proposed:**

```ts
export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/:id", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withAccess("annotations:view")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => ({
    data: await app.getById({ id: input.id, projectId: scope.id }),
  }))
  // … five more
  .build();
```

Five lines of declaration become five lines of declaration, one of them shorter.
**This is the 70% case and the ruling protects it**: a clean CRUD family is
already good, and the redesign must not tax it to fix the byte doors. It does
not — `.withAccess("annotations:view")` is two characters shorter than
`.withPermission("annotations:view")`, and it is now the *same call* the avatar
door uses.

The 4-line explicit `Readonly<{ protocol; namespace; router }>` return
annotation this file currently carries also goes: it exists because the inferred
type was unreadable, and a single `RouteShape` parameter (§3.4) makes it
readable. 34 of the 92 families carry that annotation today.

### 4.3 A tRPC family — `modules/annotation/server/src/transport/annotation.trpc.ts`

**Current:**

```ts
export const annotationTrpcTransport = defineTrpcRouter(AnnotationApi, annotationTrpc)
  .procedure("create")
  .withPermission("annotations:create")
  .handle(async ({ input, app, actor }) => app.createReview({ … }))

  .procedure("getByTraceId")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) => app.listWithUserSummaries({ … }))
  // … five more
```

**Proposed:**

```ts
export const annotationTrpcTransport = defineTrpcRouter(AnnotationApi, annotationTrpc)
  .procedure("create")
  .withAccess("annotations:create")
  .handle(async ({ input, app, actor }) => app.createReview({ … }))

  .procedure("getByTraceId")
  .withAccess("annotations:view")
  .handle(async ({ app, input }) => app.listWithUserSummaries({ … }))
  // … five more
```

The tRPC side is **already almost right**, and is the model the REST side should
copy: the contract (`defineTrpcContract`) owns name, kind and schemas; the
transport declares only policy and handler. Exactly one thing changes —
`.withPermission` becomes `.withAccess`, so a procedure and a route answer the
question with one word — and tRPC gains the same closed builder for the escapes
it needs (`throttle`d public procedures today reach for their own vocabulary).
628 procedures, one rename.

> **The symmetry question this raises, deliberately left open:** if tRPC's wire
> lives in the contract, should REST's? A `defineRestContract` owning path,
> method, params, query, input and output would make `rest-schema-from-own-contract`
> structural rather than a lint. It is not proposed here because it is a second
> redesign (of the contract packages, 92 of them) stacked on this one, and
> because REST's wire is also the public OpenAPI surface with different
> pressures. Ruled: not now (§8).

---

## 5. Migration cost

### 5.1 What the codemod can carry

The codemod is the **accelerant, not the driver** — §5.3 explains why the
compiler owns the worklist. What follows is what it can transform without
judgement, which is how much of each finding class it will clear before a human
reads the residue.

**The builder ruling makes all of it cheaper.** The chain stays a chain, so no
file changes shape: every transform below is a call rename or an argument rewrite
on a spine that stays where it is. The earlier object-literal draft needed a
structural rewrite of all 92 families; this needs none.

| Idiom | Sites | Transform | Codemod clears it? |
| --- | --- | --- | --- |
| `.withPermission(p)` → `.withAccess(p)` | 272 | call rename | yes |
| `.withPermission(p, { at: "route", param })` → `.withAccess(a => a.holding(p).checks(param))` | ~10 | call rename | yes |
| `.withAccess(publicRoute({reason: C}))` → `.withAccess(a => a.noScope().everyone().because(<C inlined>))` | 34 | rename + inline the const | yes, then a human reads each inlined reason |
| `.withAccess(anyAuthenticated({…}))` → `a.anyCaller()` *or* `a.noScope().anyCaller()` | 21 | the rename is mechanical, the **choice between the two is not** | **no — §5.2** |
| `.withAccess(optionalCredential({…}))` → `.withAccess(a => a.noScope().callerIfAny().because(…))` | 1 | rename | yes |
| `.withMiddleware(t)` → `.withFact(t)` | 168 | call rename | yes |
| `defineRestMiddleware("n", schema)` → `restFact(schema)` | 53 | drop the first argument | yes |
| `.withRawResponse({produces})` → `.withProtocolBytes({produces})` | ~100 | call rename (the reason is §5.2) | yes, the rename only |
| `defineTrpcRouter(...).procedure(n).withPermission(p)` → `.withAccess(p)` | 628 | call rename | yes |
| Inlining the 23 reason consts at their 64 sites | 64 | mechanical, but **each needs a human read** — a const serving 12 routes is 12 different sentences | rename yes, truth no |

Untouched by the migration entirely: `.withParams`, `.withQuery`, `.withInput`,
`.withOutput`, `.responds`, `.withDocs`, `.withStatus`, `.withBodyLimit`,
`.withRawBody`, `.withCache`, `.withEntitlement`, `.withIdempotency`,
`.withAudit`, `.withVersion`, `.withDeprecated`, `.methods`, `.anyMethod`, the
verb calls, `.handle` and `.build` — **1,900-odd call sites that do not move**.
That is the builder ruling's dividend, and it is also why deletion-first is
affordable: the finding classes are narrow because most of the surface is not
changing.

### 5.2 What is hand-ported

| Idiom | Count | Why it is hand work |
| --- | --- | --- |
| `.withAccess(deferredScope(...))` → structural deferral | **8 routes** | Each must name its pre-scope surface and discharge with `at(...)`. **One of the 8 — the avatar door — is provably mis-declared** (§2.1) and becomes `a.noScope().anyCaller()` instead; the files door's 2 are genuine deferrals. |
| `anyAuthenticated` → does it keep the door's scope, or not? | **21 routes** | Today the word forces `scope: DoorScope<Door>`, and §2.1 shows at least one route that cannot honour it. Each of the 21 needs one look: does its handler read `scope`? Yes → `a.anyCaller()`; no → `a.noScope().anyCaller()`. A grep for `scope` in the handler answers it in seconds, but a codemod must not guess. |
| Byte doors → `.withBytes` | **3 routes, 2 files** | New error codes + presentation entries, delete the allowance ports, wire the signing port. |
| Host-twinned facts | **10 tokens** | Import the module's token, delete the retyped schema, re-point the supply. Trivial per token, but touches a shared file — one lane, one pass. |
| A `.because(...)` for every `.withProtocolBytes` | **~100 routes** | The rename is a codemod; **the reason is not**. Each needs one written sentence. ~30 already have one in the conveyor's handoffs and can be lifted. **Converting any of these to the JSON path is out of scope** — that changes wire bytes and is a per-route behaviour decision. |
| Answering yes or no per scope-bearing key (§3.6) | **~33 routes + 43 contract keys** | Each key needs `.checks(k)` or `.doesNotCheck(k, { because })`, and **which one is a security judgement about that field**, not a rename. The *no* answers additionally need a written reason that survives review. |
| The four `*-legacy.rest.ts` families | 4 families, ~20 routes | Law says their exact bytes are preserved. `.withProtocolBytes` with the existing one-line reason. |
| `project.rest.ts`'s legacy `HttpError` pattern | 1 family | Flagged unconverted by `transport-check-project`; carried as-is or fixed in its own slice. |
| SCIM / OAuth device flow / MCP protocol doors | ~30 routes | `.withProtocolBytes` with the reasons the conveyor already wrote. |

### 5.3 Deletion is the driver, not the codemod

**Ruled by the user, 2026-09-17: delete the other way of doing it, and fix the
findings.** This replaces the earlier plan, in which v1 and v2 coexisted inside
`packages/api` until a final cleanup slice. That plan is withdrawn, and the
reasons the ruling is right are worth stating, because they are not only
tidiness:

- **The compiler enumerates the work; a codemod only guesses at it.** A codemod's
  coverage is whatever its patterns matched, and its blind spots are invisible —
  you find them in review, or you do not. Delete `.withPermission` and every one
  of its 272 REST and 628 tRPC call sites is a *named* error with a file and a
  line. The list is exhaustive by construction.
- **A parallel surface gets used.** While both spellings compile, a route written
  mid-migration can be written against v1, and nothing stops it. This is decision
  17's reasoning — no deprecated aliases — carried one step further: not even a
  transitional coexistence.
- **It matches how this repository already drives work**: a finding class with a
  count, driven to zero, with the count as the meter.

The codemod (slice 5) does not go away — it becomes the **accelerant** rather
than the driver. It does the uniform 90%, and the compiler names the residue.

**The discipline that makes it safe: a spelling dies in the same lane that fixes
its call sites.** "Delete v1 first" must not mean "delete everything, then spend
three weeks red". Each slice below removes exactly one legacy spelling, runs the
codemod for it, and drives that spelling's findings to zero **before it stops**.
The tree is red only *within* a lane, never *between* lanes — which is what keeps
`pnpm typecheck` a usable gate for every other drive sharing this checkout, and
what keeps each lane able to verify its own work.

That also fixes the slice ordering: the mechanical, uniform deletions go first
and cheaply; the ones needing judgement come last and are sized by judgement, not
by call count.

| # | Slice | What it deletes | Findings it must drive to zero | Size |
| --- | --- | --- | --- | --- |
| 1 | **`RouteShape`** | 13 positional type parameters | none — behaviour-free, deletes no spelling | large, Opus-shaped; **lands first and alone** |
| 2 | **Access vocabulary lands** | nothing yet | none — adds `.withAccess`'s two forms and the closed builder | large, Opus-shaped; the type-level core |
| 3 | **`.withPermission` dies** | `.withPermission` | **272 REST + 628 tRPC** sites | 1 lane + codemod; uniform rename |
| 4 | **The four access constructors die** | `publicRoute`, `anyAuthenticated`, `optionalCredential`, `deferredScope` | **115** sites, of which 8 deferrals and 21 `anyAuthenticated` need a decision each (§5.2) | 2 lanes; the judgement is the work |
| 5 | **`defineRestMiddleware` / `.withMiddleware` die** | both, plus string keying in `runtime.ts` | **53 tokens + 168** route sites, and the 10 host twins collapse into imports | 2 lanes; one touches the shared host file |
| 6 | **`.withRawResponse` dies** | the one raw hatch | **108** sites choose `.withBytes` / `.withEventStream` / `.withProtocolBytes` | 1 lane for the split, then slices 9–10 for the reasons |
| 7 | **`jsonResponse` / `rateLimitedResponse` / `RestErrorHandler` die** | all three exports | the 2 byte doors, 25 `jsonResponse` calls, 4 `rateLimitedResponse` calls | 1 lane, Opus-shaped — new error codes + presentation entries |
| 8 | **Strict-by-default lands; `rest-declares-input-output` dies** | the lint rule | whatever `strict: true` newly refuses across 92 families | 1 lane |
| 9–10 | **`.because` for the ~100 protocol doors** | nothing — closes slice 6's residue | ~100 written reasons | 2 lanes; judgement, not typing |
| 11–12 | **§3.6 discharges** | the un-normalised runtime guard | **~33 routes + 43 contract keys** | 2 lanes; **run the detector first** (§9) |

**Estimate: 12 slices, 14 lanes.** Every lane after slice 2 is defined by a
deletion and a finding count, so its scope is known before it starts and its
completion is not a judgement call — the spelling is gone and the count is zero.

Slices 1 and 5 are **detached** (§8): slice 1 changes no behaviour, and slice 5's
host-twin collapse is worth doing whether or not the rest proceeds.

**One caveat the ruling does not remove.** Three of the changes are *additions of
a stricter requirement* rather than deletions of a spelling — §3.6's discharge,
`.because` on a protocol door, and strict-by-default. There is no old way to
delete, so the compiler cannot produce their worklist for free. That is precisely
why §6 keeps two interim *lint* rules: a lint can name all ~33 and all ~100 at
once, before the framework lands, where a type names them one build at a time.
Type-level requirements ship as errors because they are binary; lint rules keep
the house's warn → zero → error sequence.

## 6. The lint rules under v2

One census finding drives this section. `defineRestRouter` already carries a
`StrictJsonSchemas` type parameter, and `JsonDeclarationsReady` already refuses
`handle()` on a strict route missing its input or output — but **not one of the
92 families opts in** (`grep 'defineRestRouter<'` returns nothing). The type-state
exists and is dead; `rest-declares-input-output` carries the whole law alone.

**v2 flips the default to strict.** With `RouteShape` (§3.4) that is a one-word
change — `strict: true` in the initial shape — and the escape becomes a
per-family opt-out that must say why. The lint rule then stops being the only
thing standing between the tree and an undeclared body.

| Rule | Today | Under v2 |
| --- | --- | --- |
| `rest-declares-input-output` | Fires when a route declares no `.withOutput`/`.responds`. **The only live enforcement**, because no family is strict. | **Obsolete** — strict is the default, so a missing answer refuses at `handle()` with a named type. Delete the rule; keep its fixtures as type-level tests. |
| `rest-handler-throws` | Bans `c.json`/`new Response`/manual status branches in handlers | **Unchanged and still needed**, with `jsonResponse` and `rateLimitedResponse` added to the banned symbol list (they stop being exported, so this is belt-and-braces while family lanes are in flight). |
| `rest-no-error-handler-override` | Bans `RestErrorHandler` | The type is deleted, so the rule degrades to a banned-name check. **Fold into `banned-legacy-names`** and delete the standalone rule. |
| `rest-schema-from-own-contract` | Transport files may only use their own module's contract schemas | **Unchanged in intent; its blind spot closes structurally.** That blind spot is exactly the 10 host-twinned fact schemas, which a typed token makes unwriteable (§3.3). The rule keeps its scope and simply has less to find. |
| `transport-middleware-is-a-gate` | A fact carries credentials/audit/rate-limits/body-format, never a capability or a function | **Unchanged**, retargeted from `defineRestMiddleware(` to `restFact(`. Still load-bearing: `StoredObjectFileCaller.apiKeyCeiling` is function-typed today and this rule is what stops that spreading. |
| *(new)* `rest-escape-carries-a-reason` | — | `.withProtocolBytes(...)` and `.withEventStream(...)` must be followed by `.because("…")`. Could be type-state instead, but ~100 routes need the reason *written*, and a lint names every missing one at once where a type names them one build at a time. Ship at `warn`, drive to zero, then flip to `error` — the house sequence. |
| *(new, interim)* `rest-scope-input-is-discharged` | — | Fires on a route whose params/query/input names a normalised scope or ownership key that the route answers neither yes nor no about — and on the reverse, a `.checks(k)` for a key the input does not carry. The type does this under v2 (§3.6), but a lint names **all ~33 at once** before the framework lands — which is how the holes get counted and triaged rather than discovered one build at a time. Ship it first, delete it when slices 11–12 close. |
| *(new, optional)* `access-reason-is-inline` | — | Refuses `.because(IDENT)` in favour of a string literal. Worth it only if the 64-references-to-23-consts pattern reappears after the codemod. Measure first, ship second. |

Net: **5 rules today → 3 standing.** `rest-declares-input-output` is deleted
outright because the compiler carries it once strict is the default;
`rest-no-error-handler-override` folds into `banned-legacy-names`; the other
three stand, two of them unchanged. On top sit **two interim rules** that exist
only to drive a count to zero and are deleted when it reaches zero, and one
optional rule to ship only if the measurement calls for it.

**Five** classes that a lint rule — or nothing at all — carries today become
compile errors: a missing answer, a missing access declaration, a blank reason on
an escape, an unbound fact, and a scope or ownership id in the input that the
route answers neither yes nor no about.

## 7. What does not change

Said plainly, because this proposal touches the file that expresses all of it:

- **Declared IO stays the law.** Every JSON route declares its input and its
  output; the framework parses, validates, refuses and serialises. `.withOutput`
  and `.responds` are not renamed and not relaxed — under v2 they are *more*
  binding, because §6 flips strict mode on by default and the requirement stops
  resting on a lint rule alone.
- **Throw-only errors stay the law.** `RestErrorHandler` is deleted, not
  softened. Handlers return a plain object or throw. `HandledError` only when
  the cause is known and the caller can act; everything else is a plain `Error`
  degrading to unknown + trace id. §3.5 removes the last places that hand-build
  an envelope instead of throwing.
- **Own-contract schemas stay the law.** Every wire schema comes from the
  module's own contract. The `moduleApi<X>()` app-port exception is unchanged.
- **`publicRoute`/`RestRawResult`'s sanctioned uses stay sanctioned.** Genuine
  non-JSON protocols (SCIM, OAuth device flow, MCP, webhook raw bodies) and the
  external-facing `*-legacy.rest.ts` families keep their exact bytes. They get a
  better-named hatch (`protocolBytes`) and a required reason; they do not get
  converted.
- **Wire compatibility.** Path, method, status, permission, request and response
  bytes are identical before and after for all 387 routes. The **two** deliberate
  exceptions are named in §2.3 and §3.5: the two byte doors' 429 body changes
  from `{"error":"rate_limited"}` to the canonical error envelope, and their
  404/502 bodies change from hand-built JSON to the canonical envelope — which
  is the law being applied, not a regression, and is what decision 17's "no
  legacy shapes survive" already requires.
- **§3.6 adds no new refusal to the wire that was not already intended.** The
  guard it generalises already exists and already throws; v2 moves it from a
  runtime 500 to a compile error and widens it to spellings and to `userId`. Any
  route it newly refuses is a route that was relying on convention — that is a
  hole being closed, and each is triaged by hand in slices 11–12 rather than
  auto-corrected.
- **Permissions, scopes and the authz vocabulary** are `@langwatch/authz-contract`'s
  and are not touched. `.withAccess` is a new way to *spell* a declaration that
  already exists; `AUTHZ_DECLARATION` and `declareAuthzMiddleware` keep working
  exactly as they do.
- **tRPC's contract-first shape** is the model, not the target. `defineTrpcContract`
  stays.

---

## 8. Decisions taken

Ruled by the coordinator, 2026-09-17, against this document's earlier question
numbering; restated here against the design as it now stands. **These are
settled — implement them, do not re-litigate.**

- **`.withAccess` takes both arguments.** `.withAccess("thing:read")` for the 272
  permission routes, `(a) => …` for every escape. `.withPermission` is **deleted,
  not aliased** (decision 17). The merge is free: the common case ends up two
  characters shorter than today, so one vocabulary costs the 70% case nothing.
  *Splitting the vocabulary to spare the common case is the exact mistake that
  produced the avatar door's false `deferredScope`.*
- **Names stand**, unless the user says otherwise — they are the cheapest thing
  to change and nothing downstream is written yet. This settles the call name as
  `.withAccess`, with scope organising the builder inside it (§3.1), and not
  `.withScope` or `.withGrant`.
- **REST's wire does not move into the contract now.** That is a second redesign
  across 92 contract packages; it waits until v2 has landed.
- **The ~100 raw routes are parked**, each behind a written `.because(...)`. The
  parked count becomes a meter, and conversions happen family by family, each
  with its own wire decision.
- **Slices 1 and 5 are detached and may run now**, independently of the rest of
  v2. Slice 1 (`RouteShape`) is behaviour-free and removes ~270 lines of
  positional type-parameter restatement. Slice 5 collapses the 10 duplicate
  middleware tokens and 10 hand-retyped schemas in
  `apps/api/src/app-rest/api-rest.host.ts` into imports — where `"traceparent"`
  currently names three distinct token objects and the modules' own exported
  tokens are never imported.
- **Deletion drives the migration, not the codemod** (user, 2026-09-17). No
  transitional coexistence of v1 and v2: each slice deletes exactly one legacy
  spelling and drives that spelling's compile findings to zero before it stops.
  The codemod becomes the accelerant; the compiler owns the worklist. §5.3.
- **Banked consequence.** `StrictJsonSchemas` has **zero adopters across 92
  families**, so `JsonDeclarationsReady`'s refusal is dead type-state. Once
  `RouteShape` lands, strict-by-default is one word — and
  `rest-declares-input-output` can be **deleted** rather than enforced, because
  the compiler carries the law instead (§6).

---

## 9. Still open

Only two, and both postdate the rulings above — §3.6 did not exist when they
were made.

1. **Does the *no* answer exist?** §3.6 makes every scope-bearing key take an
   explicit `.checks(k)` or `.doesNotCheck(k, { because })`. The open part is
   whether the second is offered at all. Without it, every one of the ~33 affected
   routes must be genuinely authorised; with it, a route can decline in writing.
   **§4.1 is the worked argument for offering it**: the avatar door's path carries
   a `projectId` that is a lookup key rather than a gate, the route is genuinely
   safe, and a binary with only a *yes* would force it to invent a scope check it
   does not need — while the *no* gets the safety argument written down where
   today it is written nowhere. *Recommendation: offer it. A declined check with a
   written reason is reviewable; a rule with no way to decline gets worked around
   in ways that are not.*
2. **Does the §3.6 detector run before the redesign?** It is a script or a lint,
   not a framework change, and its output is a list of routes taking an
   undischarged scope or ownership id — a list nobody has seen. *Recommendation:
   run it now, ahead of every slice. If it comes back empty, §3.6 is pure
   ergonomics and can ride along with the rest of v2. If it does not, the triage
   is more urgent than the redesign.*

---

Everything else in this document is either measured (§1, §2) or decided (§8).
The next move is the §9.2 detector, then slice 1.
