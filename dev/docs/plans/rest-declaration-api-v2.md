# The REST declaration API, v2

Status: proposal. Design-only lane, 2026-09-17. No production code changed by
this document.

This is an **ergonomics and truthfulness** redesign of how a route is declared.
It is not a behaviour redesign. Everything in
`.claude/coordinator/ARCHITECTURE-LAW.md`'s transport section is settled and
stays settled — see [§7, What does not change](#7-what-does-not-change) — and
this proposal is written to make that law *easier to obey and harder to lie
about*, not to reopen it.

**The builder stays** (user, 2026-09-17). An earlier draft of §3.4 proposed
replacing it with object literals; that is withdrawn. What the literals were
really buying — an end to the 296 lines of restated type parameters — is bought
inside the builder instead, by a single `RouteShape` parameter, and the chain
keeps the `this:`-constraints a literal could not express. The ruling also makes
the migration cheaper: no file changes shape, and ~1,900 call sites never move.

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

## 2. The four charges, as the census sees them

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

---

## 3. The v2 shape

### 3.1 One access vocabulary, two visible axes

**Ruled by the user, 2026-09-17: the builder stays.** The vocabulary below is a
builder inside the builder — one route-level call, whose argument is either a
permission or a callback into a closed access builder.

```ts
// The 272-route common case. Shorter than `.withPermission("annotations:view")` is today.
.withAccess("annotations:view")

// Everything else, through the closed builder:
.withAccess((a) => a.everyone().because("the liveness probe answers before a session exists"))
.withAccess((a) => a.callerIfAny().because("a shared link renders for signed-out readers too"))
.withAccess((a) => a.anyCaller().withDoorScope().because("listing one's own keys needs no permission"))
.withAccess((a) => a.anyCaller().withNoScope().because("any member may read any avatar; the door resolves no project"))
.withAccess((a) => a.holderOf("traces:view").atPathScope("projectId"))
.withAccess((a) => a.holderOfAny(["traces:view", "scenarios:view"])
                    .atScopeTheHandlerFinds(StoredObjectOwnerLookup)
                    .because("an object is addressed by its id, so the project that owns it is a read this handler makes"))
```

One call name, one question, and **the 70% case gets shorter than it is today**
rather than longer — which is what makes merging the two vocabularies free
instead of a tax on 272 routes. `.withPermission` is deleted, not aliased
(decision 17).

Why a callback rather than free constructors (`everyone({ because })`): the
vocabulary stays **closed and discoverable**. Typing `a.` lists exactly the
admissible openings with no imports to find, and there is no way to hand
`.withAccess` a hand-rolled object that satisfies the shape. That is the
property the current `publicRoute()`/`deferredScope()` free functions lack.

Why this makes the wrong kind hard to write:

- **`scope` is now an explicit answer, not a consequence of the word you
  picked.** The avatar door is `a.anyCaller().withNoScope()` — a true sentence
  that exists in the vocabulary. Its prose stops disagreeing with its
  declaration because the declaration can now say what the prose says.
- **`everyone()` is unmistakably public.** It is the only opening that hands the
  handler `actor: null`, and the only one the OpenAPI document publishes with no
  security requirement.
- **A reason is owed exactly where it is owed, and the type says so.** Each
  escape's terminal returns `AccessNeedingReason<…>`, which is *not* assignable
  to the `Access<…>` that `.withAccess` requires; only `.because(string)` returns
  one. So an unjustified escape does not compile. Today the reason is checked by
  `publicRoute()` **throwing at runtime on a blank string**
  (`access/access.ts:130`) — a runtime check standing in for a type. By the same
  token `a.holderOf(p)` returns `Access<…>` directly: the permission is its own
  justification and no `.because` is owed. `.atScopeTheHandlerFinds(…)` drops
  back to `AccessNeedingReason<…>`, because a deferral does need justifying.
- **A deferral is structurally discharged.** See §3.2.

Two runtime asserts in `assertRouteReady` (`declaration.ts:1670-1675`) — "must
declare withPermission() or withAccess()" and "declares both a permission and
`<kind>` access" — become unreachable: there is one call, and it takes one
argument. The first is already half-enforced by `RouteReady` making `handle`
resolve to `never`, which is where the infamous *"Expected 0 arguments, but got
1"* comes from; §3.4 replaces that with a named refusal type.

### 3.2 The deferral, made structural

A route declaring `.atScopeTheHandlerFinds(...)` gets handler arguments with
**no `app`, no `scope`, no `actor`**. It gets one thing:

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
   `.atScopeTheHandlerFinds(StoredObjectOwnerLookup)`, so the pre-scope surface
   is reviewable in the declaration rather than discoverable by reading the
   handler.
3. **The permission set stays published.** `a.holderOfAny([...])` keeps the
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
    a.anyCaller().withNoScope().because(
      "any authenticated caller may read any avatar, so the door authenticates and resolves " +
      "no project; the object's purpose and owner kind are what gate the bytes",
    ),
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

The chain is one call longer than today (`.withRateLimit` earns its place) and
the file is **~40 lines shorter**. Deleted by the shape, not by discipline: the
two rate-limit consts, the reason const, the `countAvatarRead` app method and
its allowance branch, `rateLimitedResponse`, `jsonResponse(…, 502)` (an
unexpected store failure now throws a plain `Error`, degrading to unknown + a
trace id, which is what it is), the 12-line `avatarBytes` header builder, and
the string `"userAvatarCaller"` in two files.

**And the declared access kind becomes true** — `anyCaller().withNoScope()` is
the sentence the route's own prose has been writing all along, now spellable.

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
> pressures. Recorded as open question 1 in §8.

---

## 5. Migration cost

### 5.1 What is codemod-able

**The builder ruling makes this materially cheaper.** The chain stays a chain,
so no file changes shape: every transform below is a call rename or an argument
rewrite on a spine that stays where it is. The earlier object-literal draft
needed a structural rewrite of all 92 families; this needs none.

| Idiom | Routes | Transform | Confidence |
| --- | --- | --- | --- |
| `.withPermission(p)` → `.withAccess(p)` | 272 | call rename | codemod |
| `.withPermission(p, { at: "route", param })` → `.withAccess(a => a.holderOf(p).atPathScope(param))` | ~10 | call rename | codemod |
| `.withAccess(publicRoute({reason: C}))` → `.withAccess(a => a.everyone().because(<C inlined>))` | 34 | rename + inline the const | codemod |
| `.withAccess(anyAuthenticated({…}))` → `.withAccess(a => a.anyCaller().withDoorScope().because(…))` | 21 | rename + inline | codemod |
| `.withAccess(optionalCredential({…}))` → `.withAccess(a => a.callerIfAny().because(…))` | 1 | rename | codemod |
| `.withMiddleware(t)` → `.withFact(t)` | 168 | call rename | codemod |
| `defineRestMiddleware("n", schema)` → `restFact(schema)` | 53 | drop the first argument | codemod |
| `.withRawResponse({produces})` → `.withProtocolBytes({produces})` | ~100 | call rename (the reason is §5.2) | codemod |
| `defineTrpcRouter(...).procedure(n).withPermission(p)` → `.withAccess(p)` | 628 | call rename | codemod |
| Inlining the 23 reason consts at their 64 sites | 64 | mechanical, but **each needs a human read** — a const serving 12 routes is 12 different sentences | codemod + review |

Untouched by the migration entirely: `.withParams`, `.withQuery`, `.withInput`,
`.withOutput`, `.responds`, `.withDocs`, `.withStatus`, `.withBodyLimit`,
`.withRawBody`, `.withCache`, `.withEntitlement`, `.withIdempotency`,
`.withAudit`, `.withVersion`, `.withDeprecated`, `.methods`, `.anyMethod`, the
verb calls, `.handle` and `.build` — **1,900-odd call sites that do not move**.
That is the ruling's dividend.

### 5.2 What is hand-ported

| Idiom | Count | Why it is hand work |
| --- | --- | --- |
| `.withAccess(deferredScope(...))` → structural deferral | **8 routes** | Each must name its pre-scope surface and discharge with `at(...)`. Two of them (avatar) are provably mis-declared and become `a.anyCaller().withNoScope()` instead. |
| Byte doors → `.withBytes` | **3 routes, 2 files** | New error codes + presentation entries, delete the allowance ports, wire the signing port. |
| Host-twinned facts | **10 tokens** | Import the module's token, delete the retyped schema, re-point the supply. Trivial per token, but touches a shared file — one lane, one pass. |
| A `.because(...)` for every `.withProtocolBytes` | **~100 routes** | The rename is a codemod; **the reason is not**. Each needs one written sentence. ~30 already have one in the conveyor's handoffs and can be lifted. **Converting any of these to the JSON path is out of scope** — that changes wire bytes and is a per-route behaviour decision. |
| The four `*-legacy.rest.ts` families | 4 families, ~20 routes | Law says their exact bytes are preserved. `.withProtocolBytes` with the existing one-line reason. |
| `project.rest.ts`'s legacy `HttpError` pattern | 1 family | Flagged unconverted by `transport-check-project`; carried as-is or fixed in its own slice. |
| SCIM / OAuth device flow / MCP protocol doors | ~30 routes | `.withProtocolBytes` with the reasons the conveyor already wrote. |

### 5.3 Lane slices

Per decision 17 there is **no deprecated alias period**. The cutover is
per-family but total: v1 and v2 declaration surfaces coexist inside
`packages/api` only while family lanes are in flight, and the v1 surface is
deleted in the last slice.

| # | Slice | Owns | Size |
| --- | --- | --- | --- |
| 1 | **Framework: `RouteShape`** | `declaration.ts` — 13 type parameters → one record, 296 lines → ~26, no behaviour change | large, Opus-shaped; **lands first and alone**, because everything else edits the same methods |
| 2 | **Framework: access vocabulary** | `packages/api/src/access/**`, the access builder, `AccessNeedingReason`, handler-argument types, `.withAccess`'s two admissible arguments | large, Opus-shaped — the type-level core |
| 3 | **Framework: typed facts** | `restFact`, symbol keying in `runtime.ts`, `SuppliesFor<Facts>` / `MissingFact` | medium |
| 4 | **Framework: byte doors** | `.withBytes`/`.withEventStream`/`.withProtocolBytes`, `redirectTo`/`streamBytes`, `rateLimit.per`, the signing port | medium |
| 5 | **Codemod** | `dev/scripts/` one-shot transform + fixtures | medium; must land before slice 6 |
| 6–15 | **REST families, ~9 per lane** | 92 families / 387 routes, codemod + tests per lane | 10 lanes, Sonnet-shaped |
| 16–18 | **tRPC families, ~55 per lane** | 163 files / 628 procedures — one call rename | 3 lanes, Sonnet-shaped |
| 19 | **Facts de-duplication** | `apps/api/src/app-rest/api-rest.host.ts` + the 10 owning modules | 1 lane, shared file — coordinator-held |
| 20 | **The 8 deferrals + 2 byte doors** | `stored-object`, `user`, and the 6 other deferred routes | 1 lane, Opus-shaped |
| 21 | **`.because` for the ~100 protocol doors** | one written reason each, family by family | 2 lanes, needs judgement not typing |
| 22 | **Lint rules** | `packages/oxlint-rules/src/rules/rest-*`, `dev/docs/lint-rules.md` | 1 lane |
| 23 | **Delete v1** | `.withPermission`, `.withMiddleware`, `.withRawResponse`, `jsonResponse`, `rateLimitedResponse`, `RestErrorHandler`, `defineRestMiddleware`, the four access constructors | 1 lane, must be last |

**Estimate: 23 slices, of which 15 are mechanical** — down from 24/16 in the
object-literal draft, and the mechanical ones got smaller. Slices 1–4 and 20
carry essentially all the risk. Slice 1 is worth landing on its own merits
whether or not the rest proceeds.

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
| *(new, optional)* `access-reason-is-inline` | — | Refuses `.because(IDENT)` in favour of a string literal. Worth it only if the 64-references-to-23-consts pattern reappears after the codemod. Measure first, ship second. |

Net: **5 rules today → 4**, one deleted outright because the type now carries
it, one folded into `banned-legacy-names`, one new-and-temporary to drive the
~100 reasons to zero, one optional. Four classes the rules enforce today become
compile errors: a missing answer, a missing access declaration, a blank reason
on an escape, and an unbound fact.

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
- **Permissions, scopes and the authz vocabulary** are `@langwatch/authz-contract`'s
  and are not touched. `.withAccess` is a new way to *spell* a declaration that
  already exists; `AUTHZ_DECLARATION` and `declareAuthzMiddleware` keep working
  exactly as they do.
- **tRPC's contract-first shape** is the model, not the target. `defineTrpcContract`
  stays.

---

## 8a. Coordinator rulings (2026-09-17)

**Q2 — admit both, as recommended.** `.withAccess("thing:read")` for the 272
permission routes, `(a) => …` for every escape, `.withPermission` DELETED not
aliased (decision 17). The merge is free: the common case ends up two
characters shorter than today, so one vocabulary costs the 70% case nothing.
Splitting the vocabulary to spare the common case is the exact mistake that
produced the avatar door's false `deferredScope`.

**Q1 — not now, as recommended.** REST's wire moving into the contract is a
second redesign across 92 contract packages; it waits until v2 has landed.

**Q4 — park now, as recommended.** The ~100 raw routes keep a written
`.because(...)`; the parked count becomes a meter and conversions happen
family by family, each with its own wire decision.

**Q5 — slices 1 and 19 are DETACHED and may run now**, independently of the
rest of v2. Slice 1 (`RouteShape`) is behaviour-free and removes 270 lines of
positional type-parameter restatement. Slice 19 deletes 10 duplicate
middleware tokens and 10 hand-retyped schemas from
`apps/api/src/app-rest/api-rest.host.ts` — where `"traceparent"` currently
names three distinct token objects and the modules' own exported tokens are
never imported.

**Q3 — names stand** unless the user says otherwise; they are the cheapest
thing to change and nothing downstream is written yet.

**Consequence to bank:** the census found `StrictJsonSchemas` has ZERO
adopters across 92 families, so `JsonDeclarationsReady`'s refusal is dead
type-state. Once `RouteShape` lands, strict-by-default is one word — and the
`rest-declares-input-output` lint rule can then be DELETED rather than
enforced, because the compiler carries the law instead.

## 8. Open questions for the user

1. **Should REST's wire move into the contract, as tRPC's has?** (§4.3.) It
   would make `rest-schema-from-own-contract` structural and give the browser and
   the SDK one typed source. It is a second redesign across 92 contract
   packages. *Recommendation: not now; revisit once v2 has landed and the
   contract packages are stable.*
2. **`.withAccess(p)` for a bare permission — or always the callback?** The
   proposal admits two arguments: a permission string for the 272-route common
   case, and `(a) => …` for everything else. One call name, one question, and the
   common case gets shorter than it is today. The alternative is to require the
   callback everywhere (`a.holderOf("annotations:view")`), which is more uniform
   and makes 272 routes longer. *Recommendation: admit both. Uniformity that
   taxes the 70% case is how the two vocabularies got separated in the first
   place.*
3. **Vocabulary names.** `.withAccess` / `everyone` / `anyCaller` /
   `callerIfAny` / `holderOf` / `.because` are chosen to read as English at the
   call site and to make "public" unmistakable. They are the most reversible
   decision in this document and the cheapest to change now, before the codemod
   is written.
4. **`.withProtocolBytes` for the ~100 raw routes.** This proposal parks them
   behind a written `.because(...)`. The alternative is to treat those reasons as
   a to-do list and convert them family by family in a later drive — each
   conversion changes wire bytes and needs its own decision. *Recommendation:
   park now, count the parked routes as a meter, convert deliberately.*
5. **Slice 1 (`RouteShape`) and slice 19 (facts de-duplication) are worth doing
   on their own merits**, independently of whether the rest of v2 proceeds.
   Slice 1 removes 270 lines of type-parameter restatement and changes no
   behaviour; slice 19 deletes 10 duplicate tokens and 10 hand-retyped schemas
   from `apps/api/src/app-rest/api-rest.host.ts`. Either can run now.
