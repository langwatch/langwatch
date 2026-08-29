# Typed REST context — design for approval

**Status: proposed, not built.** Nothing in this document is implemented.

## The defect

A REST handler reads its request state with `c.get("project")`. That is typed
today only because somebody hand-wrote `AppRestProjectVariables` and kept it
honest by attention. Nothing derives it, and nothing checks it.

The reason is one line in `packages/api/src/rest/security/rest-api-service.ts`:

```ts
readonly authenticateProject: (envelope: ApiErrorEnvelope) => MiddlewareHandler;
```

A `MiddlewareHandler` is opaque. It resolves a credential and writes the result
onto the context, and its type says nothing about what it wrote. So the shape
has to be restated somewhere the compiler can see it, which is
`packages/api/src/rest/app-security.ts`:

```ts
export type AppRestSecurity = RestApiService<AppRestProjectVariables, AppRestOrganizationVariables>;
```

Those two type arguments are the hand-written restatement. Everything
downstream — 163 `c.get("project")` reads — believes them rather than the
contract. When they disagreed with what the credential actually carried,
nothing failed; handlers simply could not see fields that were there.

`RestApiService` is **already generic** in both maps. The generics are correct.
They are just being passed a guess.

## The change

Make the authentication port declare what it resolves, and derive the context
from it. Two edits to the framework, no new concept:

```
BEFORE                                          AFTER

createAppRestSecurity(ports)                    createAppRestSecurity(ports)
        │                                               │
        │  ports.authenticateProject:                   │  ports.authenticateProject:
        │    (envelope) => MiddlewareHandler            │    (envelope) => Authenticates<ProjectIdentity>
        │         ▲                                     │         ▲
        │         └─ erases what it set                 │         └─ declares what it set
        ▼                                               ▼
RestApiService< AppRestProjectVariables , … >   RestApiService< Resolved<typeof ports> , … >
                ^^^^^^^^^^^^^^^^^^^^^^^                         ^^^^^^^^^^^^^^^^^^^^^^^
                hand-written, believed                          derived, cannot disagree
        │                                               │
        ▼                                               ▼
   c.get("project")                                c.get("project")
   typed by assertion                              typed by construction
```

`Authenticates<T>` is a `MiddlewareHandler` carrying a phantom `T` — the
existing middleware value is unchanged at runtime, it simply stops being
anonymous to the compiler:

```ts
export type Authenticates<T> = MiddlewareHandler & { readonly __resolves?: T };
```

The composition root already knows `T`: `ApiKeyRestSecurityAdapter.authenticate`
returns `ApiRestAuthenticatedRequest`, whose `project` is `ProjectIdentity`.
Today that knowledge stops at the adapter. This carries it through.

`AppRestProjectVariables` and `AppRestOrganizationVariables` are then deleted.
They have no author left.

## What it costs, honestly

- **The 163 call sites do not change.** `c.get("project")` keeps working and
  keeps its key; it becomes typed by derivation instead of by assertion. This
  is a framework change, not a sweep.
- **One type argument per composition root.** `createAppRestSecurity` infers
  from `ports`, so `apps/api` and `platform/app` each get their context from
  the adapter they already pass.
- **It does not remove `c.get`.** If the goal is that a handler never reaches
  into a string-keyed bag at all, that is a second, larger change: the handler
  signature grows a typed request argument (`(c, input, request)`), and that
  one does touch every handler. Worth doing, worth doing separately, and worth
  doing after this — because this one is what makes the argument's type
  derivable in the first place.

## What this does not fix

`c.app` is typed `TApp`, and feature families currently take their services as
a separate closure parameter (`services: { projects: () => ProjectService }`)
rather than through it. Folding those into `TApp` is the other half of "the
context returns only what the factory was given". It is independent of the
above and can follow it.

## Open question for review

Whether `Authenticates<T>` should be a phantom brand as written, or whether the
authentication port should stop being a `MiddlewareHandler` altogether and
become `(request: Request) => Promise<T>` with the framework owning the
middleware that installs it. The second is cleaner and is what
`ApiRestSecurityPort.authenticate` already looks like in `apps/api`; it is a
larger change to the four existing composition roots.
