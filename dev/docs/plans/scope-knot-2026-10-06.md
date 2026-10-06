# Untying the scope knot (plan, 2026-10-06)

Spec: `specs/frontend/session-permission-reads.feature` (every scenario `@unimplemented`
until its batch lands and binds it). Ruling: `dev/docs/ARCHITECTURE.md` section 10.1, the
knot paragraph (Alex, 2026-10-05): permission reads move to the session, public shared pages
get an explicit no-session host, then the call sites migrate. Section 3.5's table already names
"the session's `hasPermission` / `hasOrganizationPermission`" as how the browser learns a
permission. (The manifest cites section 11; the paragraph sits in 10.1.)

## The knot, measured

`apps/ui/src/main.tsx:125-145` composes four steps: session reading, then scope reading, then
the session port (`useBrowserUiSession`, which reads grants for the scope's project and
organization), then the scope port (`createBrowserUiScope({ reading, session })`). The last step
is the knot: `organization/.../ui-scope-capability.ts:233-251` builds the legacy `UiScopeHost`
with `hasPermission: permissions.can` and `hasOrganizationPermission: permissions.canInOrganization`
from the session. So the scope port needs the session, and every screen asking
`useOrganizationTeamProject().hasPermission` asks scope a session question.

Measured 2026-10-06 (grep, re-measure per batch):

- 540 files name `useOrganizationTeamProject` (326 production, 213 test), not 506. Only the
  ones that read a permission through it are in scope: about 59 production and 48 test files.
  The rest read scope only and stay as they are.
- 29 module host mounts already answer `hasPermission` from `session.hasPermission`
  (precedent: `modules/trace/browser/src/behavior/trace-host-mount.tsx:259`). The one that
  does not is organization's, which reads `scopeHost.hasOrganizationPermission`
  (`organization-host-mount.tsx:214`) because `UiSession` has no `hasOrganizationPermission`.
- Nine modules carry their own `useOrganizationTeamProject` shim over their own host, so their
  permission answers already come from the session. Eight production files read permissions
  from the browser-host hook directly (experiment 4, project, prompt, scenario, trace one each).
- `modules/scenario/browser/src/behavior/use-can.ts` sends its own `authz.effectivePermissions`
  read: a second grant source beside the session's.

## Defects the knot hides (found, not fixed)

1. **A signed-in member on `/share/:id` gets their real grants.** `useUiEffectivePermissions`
   (`modules/auth/browser/src/behavior/ui-session-queries.ts:59`) is enabled whenever a user and a
   project are known, and the share route resolves the shared project. Main gated the grant read
   on `!isPublicRoute` (`platform/app/src/hooks/useOrganizationTeamProject.ts:518` on origin/main),
   so every permission read false there. The spec restores main.
2. **Trace and scenario hosts shadow the shell's scope host on every route.** Module hosts wrap
   every route (`packages/browser/src/ui-module-hosts.tsx:39-51`), and `TraceHostProvider`
   (`trace-host.ts:185-211`) and `ScenarioHostProvider` (`scenario-host.ts:120-146`) each
   re-publish a `UiScopeHostProvider` without `hasOrganizationPermission` or `isDemoProject`. The
   browser-host hook therefore answers organization permissions from project grants and reads
   the demo project as false, contradicting `specs/ui/shared-scope-host.feature` ("Organization
   permissions are independent of project permissions"). Main answered `hasOrgPermission =
hasPermission` (origin/main line 537), so this is a branch spec against main's behaviour; the
   first test of batch 3 must prove the shadowing before anything changes.

## Batches (one lane each; each binds its scenarios in the same change)

| #   | What lands                                                                                                                                                                                                                | Paths (owned by that lane)                                                                                                                                                            | Binds                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `UiSession.hasOrganizationPermission` (section 3.5 names it); auth implements it over `permissions.canInOrganization`; test doubles follow; organization's host mount reads the session, not the scope host               | `packages/browser-host/src/capabilities.ts`, `testing.ts`; `modules/auth/browser/src/behavior/ui-session.ts`; `modules/organization/browser/src/behavior/organization-host-mount.tsx` | the two session scenarios                                       |
| 2   | The explicit no-session answer on public routes (decision Q1); auth's grant reads disabled there                                                                                                                          | `modules/auth/browser/src/behavior/*`; `apps/ui/src/main.tsx` if Q1 needs the route passed (shared: coordinator applies); trace and scenario host mounts only if Q1 says so           | the six public-page scenarios                                   |
| 3   | Trace and scenario stop re-publishing `UiScopeHostProvider`; the shell's is the only one (section 10.1, "the only mount pattern")                                                                                         | `modules/trace/browser/src/behavior/trace-host.ts`, `modules/scenario/browser/src/model/scenario-host.ts`, their tests                                                                | the two "under every module host" scenarios                     |
| 4a  | trace call sites: permission reads go to `useTraceHost().hasPermission`; the module shim drops `hasPermission`                                                                                                            | `modules/trace/browser/src/**` (about 20 production, 32 test files)                                                                                                                   | "A migrated screen answers ... the same as before" (first bind) |
| 4b  | gateway (10), organization (7 plus 12 organization-permission readers)                                                                                                                                                    | `modules/gateway/browser/src/**`, `modules/organization/browser/src/**`                                                                                                               | same scenario, one test per module                              |
| 4c  | experiment, prompt, project, scenario (and `use-can.ts` onto the scenario host)                                                                                                                                           | those modules' `browser/src/**`                                                                                                                                                       | Agent Testing scenario                                          |
| 4d  | langy, user, model-provider, workflow, automation, governance testing, dataset tests                                                                                                                                      | those modules' `browser/src/**`                                                                                                                                                       | same scenario                                                   |
| 5   | Delete `hasPermission`, `hasOrganizationPermission`, `hasOrgPermission` from `UiScopeHost`, `UiScopeHostReadings`, `UiScopeReading`; `createBrowserUiScope` stops taking the session; record 10.1 says the knot is untied | `packages/browser-host/src/use-organization-team-project.ts`; `modules/organization/browser/src/behavior/ui-scope-capability.ts`; `apps/ui/src/main.tsx` and the record (shared)      | the two scope scenarios                                         |

Order: 1 before 4b (organization needs the session method); 2 and 3 are independent of each other
and of 4; every 4x before 5. Batch 4 lanes run in parallel: their paths do not overlap. A screen's
permission read goes through its own module's `*HostApi`, whose mount answers `session.x()`
(section 10.1, "every method of a host is `session.x()`"); no screen reads `useUiCapabilities()`
for it.

Checks per batch: `oxfmt` and `oxlint` on touched paths; `pnpm --filter <package> test` and
`typecheck` for each touched package; `pnpm --filter @langwatch/architecture-enforcer
check:feature-parity` (the batch's scenarios move from unimplemented to bound, the unbound count
does not rise); `pnpm lint:architecture --policies peer-cycles` (must not rise).

## Decisions for Alex (not taken here)

- **Q1. Where the explicit no-session host lives.** Ruled (Alex): (a), the session decides, using
  the `isPublicRoute` it already receives; the composition passes the same flag to
  `useBrowserUiSession`.
  Options as put: (a) auth's session answers no permission on a
  public route, as one named no-session session class, using the `isPublicRoute` it already
  takes (`ui-session.ts:170-181`); one place, closest to main. (b) a screen declares itself
  public (`pages/share/[id]`) and the browser runtime mounts a no-session session under it; most
  explicit, but a new declaration slot. (c) trace's and scenario's host mounts publish a
  no-session host on public routes; local, but two copies and every future module repeats it.
  Needed to choose: whether "explicit" means a named object (a) or a declaration (b).
- **Q2. Organization permissions independent of project grants.** The branch spec says
  independent; main said the same as project. Batch 3 makes the branch spec true everywhere; a
  reader whose organization grant is narrower than a project grant sees team and plan controls
  disappear under trace and scenario pages. Confirm that is the ruling.
- **Q3. A guard against re-adding.** After batch 5 the type refuses a permission on the scope
  host; a lint rule is only needed if a module republishes one by hand. Proposed, not planned.

## Status

- Batches 1 and 2 landed: `UiSession.hasOrganizationPermission`, organization's host mount reads
  it, and on a public route the session reads no grant and answers no permission. Bound: the two
  session scenarios; the signed-in member, the unanswered session read and leaving the page.
- Still `@unimplemented` from batch 2, because each Then names the shared trace page or a module
  host (trace, scenario): the signed-out visitor, every module host (outline), no control that
  changes the trace, the unknown or revoked link. They bind in a composition test under
  `apps/ui/src/__tests__/` or in trace's share page tests.

## Wire and data

No route, procedure, input, output or stored byte changes. The one behaviour change against the
branch is defect 1 (back to main); against main, Q2.

## Done when

Every scenario in the spec is bound and none `@unimplemented`; the scope port is built without the
session; `UiScopeHost` names no permission; record 10.1's knot paragraph records it untied.
