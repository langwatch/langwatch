Feature: Admin trace access — bird's-eye drill-in with persistent 'viewing as' banner + audit-log
  Org admins need read access to user-workspace + team-workspace traces
  to do compliance, debugging, and offboarding work — but personal-
  workspace privacy makes silent admin surveillance unacceptable. The
  industry standard is **scoped read access + persistent visual context
  + audit log on every read**: GitHub Enterprise (admins viewing
  private repos triggers audit-log + repo banner), Stripe Connect
  ('Acting as <merchant>' chrome), Linear 'View as user'. Each one
  treats admin impersonation as a privileged context, not a magic
  permission.

  LangWatch matches: bird's-eye `/governance` rows are click-through to
  scoped Traces views; the destination renders a persistent
  'Viewing <user/team> as admin' banner that is server-side-gated DOM
  (NOT a transient client flag — reload-safe + CSS-regression-tested);
  every drill-in writes an OCSF audit-log row visible to org security
  admins AND to the impersonated user themselves on /me/settings →
  Activity tab.

  No admin catch-all read backdoor: the drill-in IS the only path. No
  bypass surface (no `governance.bypassAudit`, no service-token escape
  hatch, no SQL-direct without firing the audit hook) — load-bearing
  for SOC2 / ISO27001.

  User-visible disclosure: /me/settings carries a static line "Org
  admins can view your traces for compliance and debugging. Each
  access is logged at /settings/audit-log." Users can grep their own
  audit log entries to see who viewed their workspace and when.

  Pairs with:
    - specs/ai-gateway/governance/personal-workspace-features.feature  (UX contract)
    - specs/ai-gateway/governance/ingestion-attribution.feature        (security boundary)
    - specs/ai-gateway/governance/admin-oversight.feature              (bird's-eye home)
    - specs/ai-gateway/governance/birds-eye-dashboard-v2.feature       (Top-N + click-through)

  Implementation lives at:
    - langwatch/src/pages/governance/index.tsx                         (bird's-eye home)
    - langwatch/src/components/governance/AdminImpersonationBanner.tsx (persistent banner)
    - langwatch/ee/governance/services/governanceImpersonation.service.ts
                                                                       (server-side context)
    - langwatch/src/server/governance/audit/                            (OCSF emission)
    - langwatch/src/pages/me/settings.tsx                              (user-visible disclosure)

  Background:
    Given an admin "carol@acme.com" with `governance:view` permission
    And a user "ariana@acme.com" with a Personal Project + traces in it
    And a team "engineering" with shared-team traces under
        `Project.kind=team_shared`
    And both users are members of the same organization "acme"

  # ---------------------------------------------------------------------------
  # Bird's-eye click-through — entry point for admin drill-in
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-trace-access @bird-eye
  Scenario: Bird's-eye user-row click drills into the user's Personal Workspace traces
    Given the bird's-eye By-User table on /governance lists ariana
    When carol clicks ariana's row
    Then carol is routed to a scoped Traces view of ariana's
        Personal Project (e.g. `/[arianaPersonalProjectSlug]/traces`
        or `/governance/workspaces/<arianaUserId>/traces` — exact
        URL shape per Lane-B mount choice)
    And the destination page renders inside an admin-impersonating
        context (the persistent banner per next scenario fires)

  @bdd @ui @admin-trace-access @bird-eye
  Scenario: Bird's-eye team-row click drills into the team's shared-workspace traces
    Given the bird's-eye By-Team table on /governance lists engineering
    When carol clicks the engineering row
    Then carol is routed to a scoped Traces view of the team's pooled
        traces (e.g. `/governance/workspaces/team/<engineeringTeamId>/traces`)
    And NO admin-viewing-as banner renders for the team drill-through
        (ORG:ADMIN cascades to every team in the org as implicit
        membership; team-kind banner was suppressed in bug 19 because
        solo and small-org admins were seeing it on every team they
        de-facto own — the audit-log row still writes server-side)

  @bdd @ui @admin-trace-access @bird-eye
  Scenario: Bird's-eye Org-wide row is NOT click-through (synthetic bucket)
    Given the bird's-eye SpendByTeam table renders an Org-wide row
        for sources without a teamId
    Then the Org-wide row does NOT render as a clickable link
    And the row visually differentiates per the existing 'synthetic'
        subtitle treatment from G3 (already in production after a8f2342c8)

  # ---------------------------------------------------------------------------
  # Banner trigger contract: personal-workspace only
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-trace-access @banner @regression @unimplemented
  Scenario: AdminViewingAsBanner fires ONLY for cross-user personal-workspace access
    Given carol holds OrganizationUserRole.ADMIN at the org level
    When carol navigates to a project under another user's Personal
        Workspace (Team.isPersonal = true AND Team.ownerUserId !=
        carol.userId)
    Then the AdminViewingAsBanner renders at the top of the page
    But when carol navigates to a project owned by an org team carol
        is NOT a direct TeamUser of
    Then NO banner renders, because ORG:ADMIN cascades to every team
        in the org as implicit membership and the banner would be
        constantly-on noise rather than a meaningful affordance

  # ---------------------------------------------------------------------------
  # Persistent server-side-gated banner
  # ---------------------------------------------------------------------------

  # AdminViewingAsBanner exists in DashboardLayout (langwatch/src/components)
  # but no UI integration test currently asserts the cross-page persistence
  # contract. Pinning @unimplemented; backfill needs Playwright + adminViewingAs
  # session shim before a real test can drive nav across trace list / detail /
  # filter / search / URL deep-link variants.
  @bdd @ui @admin-trace-access @banner @regression @unimplemented
  Scenario: Persistent 'Viewing <user> as admin' banner renders on every admin-impersonating page
    Given carol drills into ariana's Personal Workspace traces
    Then a banner renders at the top of every page within the
        impersonating context:
      | element            | content                                                     |
      | leading icon       | 👁 (or equivalent privileged-context icon)                 |
      | primary text       | "Viewing ariana@acme.com's personal workspace as org admin" |
      | secondary text     | "This view is logged. Exit at any time."                    |
      | exit affordance    | "Exit" button → returns to /governance bird's-eye           |
      | color              | distinct from regular page chrome (warning / accent tone)   |
    And the banner stays present across:
      | nav target                                          |
      | trace list view                                     |
      | trace detail view                                   |
      | filter sidebar interactions                         |
      | search refinements                                  |
      | URL deep-links pasted into a fresh tab              |
    And the banner is NOT dismissable (no X close button) — the only
        way to remove it is via the Exit affordance, which leaves the
        impersonating context entirely

  # SSR rendering of AdminViewingAsBanner is contracted but not test-covered.
  # Needs a curl + grep harness (or jsdom + initial-HTML inspection) running
  # against the layout component's RSC output to assert the banner DOM is in
  # the initial HTML response and not hydration-injected. Pin @unimplemented.
  @bdd @ui @admin-trace-access @banner @regression @unimplemented
  Scenario: Banner DOM is server-side-gated, NOT a client-only flag
    Given carol direct-pastes `/[arianaPersonalProjectSlug]/traces` in
        a fresh browser tab (no client-side state, no SPA hydration
        from a prior bird's-eye click)
    When the page hydrates
    Then the banner DOM node is present in the SERVER-RENDERED HTML
        (visible via curl + grep before any JS runs)
    And the banner is NOT injected by a client-side useEffect / hook
        running post-render
    And the banner's render rule is the layout component detecting
        an admin-impersonating context (carol's userId is the actor;
        the URL's project/team scope is NOT one of carol's owned
        scopes; the org admin RBAC predicate fires)
    And a CSS regression that hides the banner OR a JavaScript
        regression that fails to set the impersonating-context flag
        does NOT silently bypass the audit-log emission — the audit
        row writes server-side independent of the banner DOM

  # Route-scope predicate fix landed at 3b712dd4a (no-leak onto admin-self
  # surfaces); contract is in the layout's banner-detection branch. No router
  # nav integration test covers the cross-route leak case yet; pin
  # @unimplemented until a Playwright sweep of /governance + /settings + /me
  # + /ops post-drill-in is added.
  @bdd @ui @admin-trace-access @banner @no-leak @regression @unimplemented
  Scenario: Banner is scoped to project-anchored URLs only — does NOT leak onto admin-self surfaces
    Given carol previously drilled into ariana's Personal Workspace
    And `useOrganizationTeamProject` has resolved the team / project
        context to ariana's workspace and KEEPS that resolved across
        navigation (sticky resolution is by design — the cache makes
        navigation back-and-forth fast)
    When carol navigates AWAY from the impersonating context to any
        admin-self surface:
      | route                | scope                              |
      | /governance          | org-scope admin home              |
      | /settings/*          | org-scope admin config            |
      | /me                  | personal-self                     |
      | /me/settings         | personal-self config              |
      | /me/sessions         | personal-self                     |
      | /ops/*               | platform-internal admin           |
    Then the AdminViewingAsBanner DOES NOT render on any of those
        routes (regardless of the still-resolved sticky-team-context
        from the prior drill-in)
    And the banner detection rule is gated on
        `router.pathname.startsWith("/[project]")` — only project-
        anchored URLs are candidates for the impersonating-context
        check (Ariana QA caught the leak in `3b712dd4a` where the
        banner stayed on /governance after a back-navigate from
        the personal-project drill-in)
    # Regression-invariant: banner detection MUST NOT depend on
    # team-resolution alone — the route shape is the load-bearing
    # signal that 'this is a workspace view' vs 'this is admin-self'.

  @bdd @ui @admin-trace-access @banner @reload-safe
  Scenario: Banner survives reload + direct-paste without client-side state seeding
    Given carol is in the impersonating context viewing ariana's traces
    When carol reloads the page (Cmd-R / F5)
    Then the banner re-renders with identical DOM + visual state
    And there is NO loss-of-context where the banner momentarily
        disappears during reload (because banner state is derived
        from the URL scope + admin RBAC, not from React component
        state that would be lost on unmount)

  # ---------------------------------------------------------------------------
  # Audit-log emission on every drill-in
  # ---------------------------------------------------------------------------

  @bdd @audit @admin-trace-access
  Scenario: Every admin drill-in emits an OCSF audit-log row
    Given carol enters the impersonating context for ariana's workspace
    When the page loads (or, on direct-paste, when the
        impersonating-context server-side check fires)
    Then exactly one OCSF audit-log row is emitted per impersonating-
        context entry (NOT per page render — a single drill-in is
        one entry, not a stream; implemented via Sergey's
        `AdminWorkspaceViewAuditService` (`24fb3dc44`) idempotent
        within a 5-min window per `(admin, target, kind)`, so the
        Lane-B `useEffect`-based emission can fire on every page
        paint without flooding the audit log)
    And the row shape is:
      | field         | value                                                          |
      | category      | "user_account"                                                 |
      | class         | "workspace_view"                                               |
      | severity      | "informational"                                                |
      | actor.userId  | carol's userId                                                 |
      | actor.email   | carol@acme.com                                                 |
      | target.userId | ariana's userId (when drilling into a user)                    |
      | target.teamId | engineering teamId (when drilling into a team)                |
      | target.scope  | "personal_workspace" / "team_workspace"                        |
      | metadata      | `{ entryUrl, drillInSource: 'birds_eye_row' / 'direct_paste' }` |
      | occurredAt    | server timestamp                                               |

  @bdd @audit @admin-trace-access @user-visibility
  Scenario: Impersonated user can grep their own audit log to see who viewed
    Given an org admin previously drilled into ariana's workspace 3 times
    When ariana navigates to `/me/settings → Activity` tab
    Then ariana sees the 3 audit-log rows scoped to her own
        impersonation history (actor = admin, target = ariana)
    And the rows display: actor name + email, occurredAt, drill-in
        source (bird's-eye row / direct-paste)
    And ariana CANNOT see other users' audit-log entries via her
        Activity tab (the same row table is scoped to `target.userId
        = ariana` for member view)
    And org admins via `/settings/audit-log` see the full audit feed
        with all admin / user audit rows

  # ---------------------------------------------------------------------------
  # NO bypass surface — SOC2/ISO27001 load-bearing invariant
  # ---------------------------------------------------------------------------

  @bdd @audit @admin-trace-access @regression @idempotent
  Scenario: Audit emission is idempotent within a 5-min window per (admin, target, kind)
    Given carol drills into ariana's Personal Workspace at T=0
    And the AdminWorkspaceViewAuditService writes one audit-log row
    When carol's page re-paints, refreshes, navigates within the same
        impersonating context, OR re-enters the same context within
        5 minutes
    Then NO new audit-log row is written within the 5-min window
    And exactly one row total exists for the (carol, ariana,
        personal_workspace) tuple over the window
    When carol re-enters the context AFTER the 5-min window has elapsed
    Then a new audit-log row is written (the cool-down is a per-tuple
        rolling window, not a once-per-session-ever)
    And the dedup is implementation of the 'one row per
        impersonating-context entry' invariant — Lane-B can safely
        drive emission from a `useEffect` keyed on
        (project.id, adminViewingAs flag) per Sergey's hook-point
        suggestion without flooding the audit log

  @bdd @audit @admin-trace-access @no-bypass @regression
  Scenario: Self-view short-circuit — no audit row for own-workspace or team-member view
    Given carol is viewing her own personal workspace
    Or carol is viewing a team workspace where carol IS a TeamUser member
    When the AdminWorkspaceViewAuditService is called
    Then NO audit-log row is written (self-view + member-view are not
        impersonating contexts; emitting rows there would be noise)
    And the service short-circuit returns `recorded=false` for the
        caller's confirmation

  @bdd @audit @admin-trace-access @no-bypass
  Scenario: Admin reads of user-scoped data ALWAYS fire the audit-log
    Given the audit emission service is in the read-path of every
        admin-impersonating tRPC call
    When carol's bird's-eye drill-in calls `trace.list` /
        `trace.getById` / any user-scoped read endpoint within the
        impersonating context
    Then the audit-log row is emitted as part of the read pipeline
    And there is NO `governance.bypassAudit = true` flag, NO
        service-account token that bypasses the audit, NO SQL-direct
        helper that admins can use without firing the hook
    And removing the audit emission from the codebase is a regression
        that the integration test catches (the regression test asserts
        the OCSF event count after a known drill-in sequence)

  @bdd @audit @admin-trace-access @no-bypass
  Scenario: Even support / debugging access uses the same drill-in path
    Given the org has shipped LangWatch internal support tooling
    When a LangWatch internal support user (NOT a customer admin)
        needs to inspect customer trace data for debugging
    Then the support user uses the same bird's-eye drill-in surface
        with the same banner + audit emission
    And there is NO separate 'support tools' surface that bypasses
        the audit log
    And LangWatch internal access is auditable to the customer org
        (the audit row is visible to the customer org admin even
        when actor is a LangWatch internal user)

  # ---------------------------------------------------------------------------
  # Write-affordance gating — admin context is read-mostly, dual-write avoided
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-trace-access @write-gate
  Scenario: Admin in impersonating context cannot dual-write as the user
    Given carol is in the impersonating context viewing ariana's workspace
    When carol attempts a write action that would mutate ariana's data
        (e.g. annotate a trace, add to a dataset, score with an
         evaluation, schedule an automation, mint a Personal VK)
    Then the action is either:
      | option                                          |
      | DISABLED in the UI with a tooltip explaining   |
      | WARN-ON-CONFIRM via a modal naming carol as actor |
    And in either case, the action's audit-log entry records carol
        as the actor (NOT ariana), so the trace-of-mutation is honest
    And destructive actions (delete a dataset, delete an annotation,
        revoke a VK) are gated to WARN-ON-CONFIRM at minimum (never
        DISABLED, since admins legitimately need offboarding /
        compliance-driven write capability)

  # ---------------------------------------------------------------------------
  # User-visible disclosure copy
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-trace-access @disclosure
  Scenario: /me/settings carries the admin-can-view disclosure
    Given ariana navigates to `/me/settings`
    Then a static copy line reads:
      "Org admins can view your traces for compliance and debugging.
       Each access is logged in your Activity tab."
    And the line links to `/me/settings → Activity` tab inline
    And the disclosure is NOT a dismissable banner / one-time onboarding
        — it's persistent settings copy so users discover it any time
        they wonder about admin visibility

  @bdd @ui @admin-trace-access @disclosure
  Scenario: Self-audit Activity tab is discoverable from Personal Workspace surfaces
    Given ariana is on /me with the disclosure copy visible
    When ariana clicks the disclosure's inline 'Activity' link
    Then she lands on `/me/settings → Activity` tab
    And the tab renders the audit-log rows scoped to her workspace
        per the @user-visibility scenario above

  # ---------------------------------------------------------------------------
  # Cross-org isolation — admin in org A cannot drill into org B
  # ---------------------------------------------------------------------------

  @bdd @audit @admin-trace-access @cross-org
  Scenario: Admin in org A cannot drill into org B's workspaces
    Given carol is admin of org A only
    And user wendy is in org B (totally separate org)
    When carol attempts to drill into wendy's workspace via
        URL-pasting the org-B drill-in URL
    Then the request fails with 403 / NOT_FOUND (the org-scoping
        guard fires before the impersonating-context check; carol
        is not a member of org B at all)
    And NO audit-log row is written (the cross-org rejection is
        before the audit hook; the failed-auth attempt is logged
        for security telemetry instead per
        ingestion-attribution.feature @cross-org scenarios)
    And NO part of org B's data is enumerable via this surface
