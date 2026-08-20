# ADR-112: No version-less API paths

## Status

Proposed

## Context

Every service built on `@langwatch/api` mounts each endpoint three ways
(`packages/api/src/route-mounting.ts`):

```
/api/role-bindings/2026-08-07/...   dated version
/api/role-bindings/latest/...       rolling alias, explicit in the URL
/api/role-bindings/...              bare alias — no version anywhere
```

The bare alias serves whatever `latest` resolves to, and it is the **only**
mount the OpenAPI document publishes (`packages/api/src/pipeline.ts`,
`isDocumentedMount`: `status === "unversioned"` only). The dated and `latest`
mounts serve traffic with version response headers but never appear in the
spec.

The combination is the problem:

```
  what exists                        what a caller can see
  ───────────────────────────       ─────────────────────────────────
  /api/role-bindings/2026-08-07     spec:      /api/role-bindings
  /api/role-bindings/latest         SDK:       /api/role-bindings
  /api/role-bindings          ────► their code: /api/role-bindings

                                    nothing anywhere says
                                    "you are pinned to nothing"
```

A caller who reads the published document, or a generated SDK, sees a URL with
no version in it. They have no reason to suspect versions exist, so they are
riding `latest` without ever having chosen to — and the first breaking version
bump breaks them silently. An implicit default is only acceptable when
following it is harmless; here it is precisely the dangerous choice.

### Why now is the cheap moment

Exactly four route families sit on `@langwatch/api`: `organization`, `roles`,
`role-bindings`, `scim-tokens` — all Enterprise-gated RBAC management surface
with negligible external adoption. Every family declares the same single
version, `MANAGEMENT_API_VERSION = "2026-08-07"`. The integration tests and
the published document both use the bare paths today, so they move in the same
change. The cost of this break only grows from here.

The legacy SecuredApp REST routes (`/api/prompts`, `/api/traces`, …) are
genuinely unversioned and are **out of scope**: they predate the versioning
machinery and retrofitting it there buys nothing.

## Decision

### 1. The bare alias is removed

`mountService` stops mounting the unversioned alias. A request to
`/api/role-bindings/` (no version segment) gets a 404, exactly as an unknown
version segment does today via the namespace guard. There is no way to reach
an endpoint without a version in the URL.

The `/latest/` mount **stays**: it names the choice in the URL. A caller on
`/api/role-bindings/latest/...` can see they opted into a rolling pointer;
the hazard being removed is the caller who never saw a version at all.

### 2. The OpenAPI document publishes every version, grouped

`isDocumentedMount` inverts its rule: dated mounts are documented; the
`latest` and (removed) bare mounts are not. With one live version everywhere,
the published document grows by zero operations — every path simply gains its
date segment.

Versions group per service, and the document says which is latest:

- every operation carries `x-api-version: "2026-08-07"`;
- each service's tag carries `x-api-versions: ["2026-08-07"]` and
  `x-latest-version: "2026-08-07"`.

`latest` is deliberately not published as a path: documenting it would invite
integrators to build unpinned, which is the behaviour this ADR exists to end.

### 3. Operation ids are pinned, not derived from the dated path

hono-openapi derives an operation id from the mounted path, so a dated path
would put the date inside every generated SDK identifier and churn them all on
every version bump. Instead:

- the **latest** dated mount takes the id derived from the *version-less*
  path shape (i.e. today's ids, unchanged — the generated Python and
  TypeScript clients keep their current module and method names);
- a **superseded** dated mount, once one exists, takes the same id suffixed
  with its date (`listRoleBindings_2026_08_07`), so two documented versions
  of one endpoint never collide.

An endpoint that must pin its id regardless already can, via
`docs.operationId`; that mechanism is unchanged.

### 4. Internal services follow the same rule

The session-authenticated project services of
[ADR-111](111-session-authenticated-project-endpoints.md) mount the same way.
The app calls the dated path, importing the service's version constant — the
client and server ship from the same tree, so the constant is shared, not
duplicated. Their endpoints are `docs.hide` and never reach the document at
all, but the no-version-less-path rule holds for them identically: an
endpoint the app forgot to version-qualify fails loudly in development, not
quietly against `latest`.

## Consequences

- **Breaking** for any caller of a bare `/api/{organization,roles,role-bindings,scim-tokens}`
  path. All known callers are the repo's own tests and generated clients,
  which this change updates; the families are Enterprise-gated with
  negligible external adoption.
- The published document's paths change spelling (`/api/role-bindings` →
  `/api/role-bindings/2026-08-07`), but operation **ids** do not, so
  generated SDK code is identifier-stable.
- The route-policy registry sheds one mount per endpoint (the alias),
  shrinking the audit surface; the namespace guards are unchanged.
- Future version bumps become visible by construction: a caller must edit the
  date in their URL (or have chosen `/latest/` in writing) to move.
- `check:openapi-completeness` and `check:openapi-route-coverage`
  expectations update in the same change; the docs pages and SDK clients
  regenerate.

## Deployment Impact

None. No chart, env var, or migration changes. The four affected route
families are served by the same app deployment; the URL change ships with the
code that serves it.
