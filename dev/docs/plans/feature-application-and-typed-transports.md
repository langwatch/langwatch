# The feature application and its two typed doors

**Status: design + plan, for approval. Not built.**
Spec: `specs/server/feature-application-and-transports.feature`.
Reference feature: **`secret`**.

## What I found before designing anything

The framework you are asking for mostly exists. It is not being used.

| | Exists | Adoption |
| --- | --- | --- |
| REST endpoint builder with type-state (`createRestService`) | yes | **3 files** |
| REST legacy path (`security.createProjectApp`, raw Hono, hand-written `Variables`) | yes | **39 files** |
| tRPC procedure builder with type-state (`PendingPermissionProcedureBuilder`) | yes | in use |
| Per-feature application bag on the context | as a structural type, declared **inline and privately** in each api file | 75 files |
| Per-feature application **class** | no | 0 |
| `app/` directory kind in the layout grammar | added this session | 1 (`user`) |

The REST builder already does the hard part. `RestService<TApp, TPermission, TRateLimit, TResourceLimit>` carries type-state booleans, and `define` must return an endpoint with all of them `true` — so an endpoint with no declared permission, rate limit or resource limit **cannot compile**. `TApp` is already threaded to the handler as `c.app`. The tRPC side does the same trick differently: `PendingPermissionProcedureBuilder` will not yield a usable procedure until `.input()` and a *declared* authz middleware have both been supplied.

So this is not "build a framework". It is: **give both builders the same context, give the feature something worth putting in it, and move 39 families onto the path that already exists.**

## The three gaps

**1. `TApp` is never bound to anything.** The one modern REST family passes `app: () => ({ secrets: options.secrets })` — an ad-hoc object literal built at the composition root. The 75 tRPC files each declare their own `<Feature>Application` bag inline. Nothing is shared, nothing is reusable, and a REST family cannot reach a tRPC family's bag or vice versa.

**2. There is no `c.auth`.** REST exposes `c.actor()` and `c.authorize(p)`; tRPC exposes `ctx.session` in a shape each feature restates. Neither is derived from what the process's authentication actually resolves — which is the defect written up in `typed-rest-context-design.md`: every security port is typed `MiddlewareHandler`, which erases what it wrote onto the context, so the shape has to be restated downstream where the compiler can see it.

**3. Domain rules are stranded in transports.** `resolvePersonalCaller` — the rule deciding whose data a personal-workspace read answers for — lived in `packages/api/src/rest/personal-caller.ts`. A domain rule inside the REST package, unreachable from tRPC. It is now on `UserApp`; it is not the only one.

## The design

```
packages/features/<feature>/server/src/
  app/<feature>.app.ts        the App class: every service and port the
    │                         feature needs, and the operations both doors call
    │
    ├── api/app-trpc/<f>.api.ts        ─┐  different endpoints,
    └── api/app-rest/<f>.api.ts        ─┘  different paging, one implementation

both handlers see:
    c.app    typed to the App the composition root constructed
    c.auth   typed to what the process's authentication resolved
    input    already validated against the declared schema
```

### The App

One class per feature. Not two. It is constructed once per process from the feature's own services and ports, and it is where validation, usage accounting and any rule both doors need actually live.

```ts
export class SecretApp {
  static create(deps: { secrets: SecretService; /* ports… */ }): SecretApp
  private constructor(private readonly deps: …) {}

  listForProject(input: { projectId: string; page: Paging }): Promise<Secret[]>
  upsert(input: { projectId: string; secret: SecretDraft; by: Caller }): Promise<Secret>
}
```

A door shapes what it *asks for* — the public REST door caps its limit lower and pages by cursor, the internal tRPC door pages by offset — by passing different arguments. It does not get a different operation. **Sub-apps stay out of the design until a case appears that arguments cannot express**; splitting `SecretApp` into `SecretRestApp`/`SecretTrpcApp` on day one would recreate the two-implementations problem the class exists to remove. If one arrives, it splits then, and the split is visible.

### The context

```ts
type FeatureContext<TApp, TAuth> = {
  readonly app: TApp;     // what the composition root constructed
  readonly auth: TAuth;   // what authentication resolved
};
```

Both transports take the same pair. `TAuth` is *derived*, not written: the authentication port stops being an opaque `MiddlewareHandler` and declares what it resolves, so `AppRestProjectVariables` and every hand-written `<Feature>TrpcContext` session shape are deleted rather than maintained.

`c.auth` carries the caller and the scope the credential resolved to — for a project-scoped REST request, the `ProjectIdentity` and the actor; for a tRPC session, the session's user. What it carries is whatever the process's authentication returns, and the handler sees exactly that.

### Declaring an endpoint

Unchanged for REST — this is already the shape:

```ts
rest.get("/secrets", "2026-08-07", (e) => e
  .withDocs({ summary: "List secrets" })
  .withPermission("project:view")
  .withInput(listSecretsInput)
  .withOutput(secretListOutput)
  .handle((c, input) => c.app.listForProject({ projectId: c.auth.project.id, page: input })));
```

tRPC keeps its own spelling (`.input()` then a declared authz middleware then `.query`/`.mutation`) because its type-state machinery is built on tRPC 11's builder and cannot be replaced without forking it. **What converges is the declaration order and the handler body, not the punctuation**: input, then output, then policy, then a handler that calls `c.app` and returns a value.

## What I am not proposing

- **Not** replacing tRPC's builder with REST's. `.input()`'s parameter type is a two-branch conditional (`TInputOut extends UnsetMarker ? $Parser : TypeError<…>`) which no generic wrapper can satisfy — the documented dead end at `trpc-permission-builder.ts:365`. Converging the punctuation means forking tRPC's builder. Not worth it.
- **Not** sweeping the 39 legacy REST families in this step.
- **Not** removing `c.get` in this step. It becomes typed first; removing the string key is a later, separate change.

## The plan, for `secret` only

`secret` because it is the only feature already on the modern REST path, it has both doors in-package (`api/app-trpc/secret.api.ts`, `api/public-rest/secret.api.ts`), it has a complete service/port/repository/adapter, and it has specs (`specs/secrets/`). Its REST family is ~1 screen, not 2,000 lines.

| # | Step | Touches | Proves |
| --- | --- | --- | --- |
| 1 | `app/secret.app.ts` — `SecretApp` holding `SecretService` and the feature's ports | 1 new file | The App exists and is composable |
| 2 | Move the two doors' shared logic onto it; handlers become delegation | 2 api files | One rule, two doors |
| 3 | Bind `TApp = SecretApp` in the REST service config, replacing the ad-hoc literal | 1 composition site | `c.app` typed from the composition root |
| 4 | Give the authentication port a declared resolution; derive `c.auth` | `packages/api/src/rest/security/*` | `c.auth` typed, not restated |
| 5 | Same context pair on the tRPC door; delete `SecretTrpcContext`'s hand-written bag | 1 api file | Both doors, one shape |
| 6 | Bind the spec: replace `@unimplemented` with real tags, add `@scenario` annotations | spec + tests | Not vacuously bound |

Step 4 is the one with blast radius beyond `secret` — it changes a shared port signature. If that turns out to be larger than it looks, steps 1–3 and 5 still stand on their own and `c.auth` lands separately.

### Then, and only then

The 39 legacy REST families move onto the modern path one at a time, each gaining an App. That is the sweep, and it should not start until `secret` is green and you have looked at it.

## Open questions for you

1. **Where is the App constructed?** `platform/app/src/server/app-layer/app.ts:98` is one global `App` installed by `appContextMiddlewareFor`. Per-feature apps can hang off it during the transition, or each composition root (`apps/api`, `apps/worker`, `platform/app`) builds them directly. The second is the end state; the first is less disruptive now.
2. **A third directory name is in play.** `api/app-trpc/`, `api/app-rest/` and `api/public-rest/` all exist. `secret` uses `public-rest`. Do public and internal REST stay separate directories, or is it one `app-rest` with the public/internal distinction carried by the service config?
3. **Does `c.auth` name its scope?** For a project-scoped request it can carry `ProjectIdentity` directly (`c.auth.project.id`), or stay caller-only with the project separate. The first reads better and is what the credential actually resolved; the second keeps `auth` meaning strictly "who".
