Feature: Personal-workspace progressive feature unlock — minimal-by-default, click-to-enable
  The personal workspace at /me is a trial-wedge surface. By default it
  exposes only the Traces Explorer + lightweight admin (Sessions /
  Settings) — NOT the full LLMOps library (Evaluations / Datasets /
  Annotations / Automations). End users who grow into needing those
  features unlock them by either:

    (a) flipping a single 'Enable advanced features' checkbox in
        /me/settings → 'Workspace features' card, OR
    (b) clicking a disabled-feature button on a trace in the Traces
        Explorer → modal asks 'Enable advanced features in your
        personal workspace?' → consent flips the bundle + the user
        proceeds with the action that triggered the modal inline.

  The single-checkbox UX is intentional (less choice paralysis on the
  trial wedge; matches Linear 'Enable Initiatives' and Vercel
  Speed-Insights+Web-Analytics+Drains one-click onboarding). Storage
  is per-feature so future granular toggles unbundle without
  migration (`Project.personalFeatures` JSON column with four
  boolean members).

  Pairs with:
    - specs/ai-gateway/governance/persona-aware-chrome.feature  (sidebar shape)
    - specs/ai-gateway/governance/persona-home-content.feature  (page body content)
    - specs/ai-gateway/governance/admin-trace-access.feature    (admin drill-in)
    - specs/ai-gateway/governance/ingestion-attribution.feature (security boundary)

  Implementation lives at:
    - langwatch/prisma/schema.prisma `Project.personalFeatures` JSON
    - langwatch/src/server/api/routers/personalWorkspaceFeatures.ts (tRPC)
    - langwatch/src/components/me/PersonalSidebar.tsx (nav predicate)
    - langwatch/src/pages/me/settings.tsx 'Workspace features' card
    - langwatch/src/components/traces/EnableAdvancedFeaturesModal.tsx
    - langwatch/src/server/governance/audit/personalWorkspaceFeatures.audit.ts

  Background:
    Given a user "ariana@acme.com" who is a member of the personal-only
      persona (Personal Team + Personal Project + at least one Personal VK)
    And the user has just signed up + completed /onboarding/welcome
    And the user's Personal Project has `personalFeatures` defaulted to
      `{evaluations: false, datasets: false, annotations: false, automations: false}`
    And the user is signed in and on /me

  # ---------------------------------------------------------------------------
  # Default sidebar shape — minimal-by-default
  # ---------------------------------------------------------------------------

  @bdd @ui @personal-workspace @default-shape
  Scenario: Default /me sidebar shows Traces but not library entries
    When the personal-scope sidebar renders
    Then the sidebar shows in order:
      | entry           | visible-by-default                                                         |
      | My Usage        | yes                                                                        |
      | Traces          | yes — link points at the explorer scoped to the user's Personal Project    |
      | Sessions        | yes                                                                        |
      | Settings        | yes                                                                        |
    And the 'Traces' link target is the existing Traces Explorer v2 mounted
        on the user's personal project — NOT a separate user-scoped explorer
        (the v2 explorer is project-URL-scoped per Lane-B's probe; personal
        project IS a project with `Project.isPersonal=true` + `ownerUserId`
        per `prisma/schema.prisma:407`)
    And clicking 'Traces' must NOT flip the chrome to the project-shell
        — the PersonalSidebar stays present throughout the user's
        navigation in their own personal project (the `/me` chrome
        is the persona-aware design surface; chrome-flipping on click
        would be a UX regression relative to the persona-aware
        design rchaves locked earlier)
    And the implementation shape is open per Lane-B's mount choice
        as long as the chrome-retention invariant holds. Two valid
        shapes (Lane-B shipped the second):
      | shape                                                                    | how chrome-retention is achieved                                              |
      | `/me/traces` thin wrapper mounting `<TracesPage projectId={...}/>`        | wrapper renders inside MyLayout; explicit prop bypasses URL-scoped project    |
      | `/[personalProjectSlug]/*` URLs render PersonalSidebar via layout discriminator (`isPersonal=true && ownerUserId=me`) | chrome layer consults `Project.isPersonal + ownerUserId`; TracesPage hooks unchanged (40+ useOrganizationTeamProject callsites still resolve project from URL) |
    And the user's personal project slug + id are resolvable via the
        existing `personalProject` resolver (no new tRPC needed)
    And the sidebar does NOT show:
      | Evaluations | (gated by `personalFeatures.evaluations`)         |
      | Datasets    | (gated by `personalFeatures.datasets`)            |
      | Annotations | (gated by `personalFeatures.annotations`)         |
      | Automations | (gated by `personalFeatures.automations`)         |
      | Library     | (any combined-library section)                    |
      | Optimization Studio                                             |
    And the sidebar entry hide rule is `!personalFeatures[<key>]`
        evaluated per render — instant re-render when the bundle flips

  # ---------------------------------------------------------------------------
  # Storage model — per-feature JSON, single-UX-action
  # ---------------------------------------------------------------------------

  @bdd @data @personal-workspace @storage
  Scenario: Project.personalFeatures stores per-feature booleans
    Given the user's Personal Project row is loaded
    Then `Project.personalFeatures` is a JSON column shaped:
      ```
      { evaluations: boolean,
        datasets: boolean,
        annotations: boolean,
        automations: boolean }
      ```
    And the default for newly-created Personal Projects is all-false
    And the column exists ONLY on Projects with `isPersonal=true`
        (team / project-shared workspaces are not feature-gated; they
        always show the full library — this is a personal-trial-wedge
        affordance, not a tier mechanism)

  @bdd @ui @personal-workspace @storage
  Scenario: Single 'Enable advanced features' checkbox flips all four to true atomically
    Given the user is on /me/settings → 'Workspace features' card
    When the user toggles 'Enable advanced features'
    Then `personalWorkspaceFeatures.enableAll` is called
    And `Project.personalFeatures` is updated atomically to
        `{evaluations: true, datasets: true, annotations: true, automations: true}`
    And the sidebar re-renders within the same React commit cycle
        showing Evaluations / Datasets / Annotations / Automations entries
    And an audit-log row is written `actor=userId, action='personalWorkspaceFeatures.enableAll', target=personalProjectId`

  # ---------------------------------------------------------------------------
  # Click-to-enable modal — discovery in context
  # ---------------------------------------------------------------------------

  @bdd @ui @personal-workspace @modal
  Scenario: Clicking a gated feature in Traces Explorer opens the enable modal
    Given the user has `personalFeatures.datasets = false`
    And the user is on Traces Explorer viewing a single trace
    When the user clicks "Add to dataset" on the trace's action menu
    Then a modal opens with:
      | element       | content                                                                |
      | Title         | "Enable advanced features in your personal workspace?"                |
      | Body          | brief explanation of what gets unlocked + that data persists if disabled later |
      | Primary CTA   | "Enable" — flips ALL four features to true atomically                |
      | Secondary CTA | "Not now" — closes modal, no flip                                    |
    And on "Enable":
      And `personalWorkspaceFeatures.enableAll` is called
      And the modal closes
      And the original action proceeds inline within the SAME UI step —
          no page reload, no second confirmation modal, no second-step
          dialog wrapping the same intent
          (Master orchestrator locked behavior (b): one-modal flow; only
          exception is when the triggering feature naturally opens its
          OWN existing dialog as the continuation, e.g. the dataset-add
          drawer that always opens when adding to a dataset — that's
          part of the dataset feature's own UI, not a meta-confirmation
          on top of the enable flow)
      And the sidebar re-renders with the new entries unlocked

  @bdd @ui @personal-workspace @modal
  Scenario: The same modal fires on every gated-feature trigger that exists in traces-v2 today
    Given the user has the bundle disabled
    When the user clicks any in-traces-v2 trigger from the canonical
        list of action surfaces shipped with personal-workspace v1:
      | trigger                                                 | feature      |
      | IOViewer 'Annotate' button                              | annotations  |
      | TurnAnnotations 'Annotate' popover (per-turn)           | annotations  |
      | TurnAnnotations 'Suggest' popover (per-turn)            | annotations  |
      | TurnAnnotations 'Dataset' button (per-turn)             | datasets     |
      | BulkActionBar 'Add to dataset' (multi-trace selection)  | datasets     |
    Then the same enable modal opens (`PersonalFeatureGateDialog`
        driven by `usePersonalFeatureGate(<feature>)`)
    And consent flips the bundle (atomic via the personalWorkspaceFeatures
        service) and resumes the triggering action — the popover /
        drawer / picker that is the action's natural continuation opens
        per modal-flow (b)
    And cancel returns the user to wherever they were

  @bdd @ui @personal-workspace @modal @future-surfaces
  Scenario: Future trigger callsites adopting the gate invariant
    Given Evaluations + Automations do NOT have a trace-explorer trigger
        callsite today (they live at `/[project]/evaluations/new` +
        `/[project]/automations` page surfaces, not in features/traces-v2)
    When future work adds a trigger for either feature inside the
        traces-v2 explorer (e.g. 'Run evaluation on this trace' or
        'Schedule recurring run on this query') OR a project-shell
        preflight before navigating to those page surfaces from /me chrome
    Then that new trigger MUST use `usePersonalFeatureGate(<feature>)`
        + render `<PersonalFeatureGateDialog>` inline — the hook + dialog
        are the canonical contract; per-surface wiring is mechanical
    And the same modal-flow (b) invariant holds: confirm flips the bundle,
        original action proceeds inline; cancel bails

    # Lane-B reported via grep that no trace-explorer trigger exists for
    # evaluations / automations today; per master orchestrator's scope
    # acceptance (2026-05-08 channel ratification), wiring those page
    # surfaces is a follow-up, not a blocker on this PR. The invariant
    # above ensures any future adopter follows the same shape.

  # ---------------------------------------------------------------------------
  # tRPC routers stay open — bundle is a UI/nav predicate, not an auth gate
  # ---------------------------------------------------------------------------

  @bdd @api @personal-workspace @predicate-only
  Scenario: Disabling the bundle does NOT close tRPC routers — UI hides, data accessible
    Given the user previously had `personalFeatures.datasets = true` and authored
        Datasets / Evaluations / Annotations / Automations during the enabled window
    When the user disables the bundle in /me/settings
    Then `Project.personalFeatures` flips to all-false
    And the sidebar entries for the four features hide on next render
    And the underlying tRPC routers (`datasets.*`, `evaluations.*`,
        `annotations.*`, `automations.*`) STAY OPEN — calling them with
        valid auth still resolves data
        (the bundle is a UX/nav predicate, NOT an authorization gate)
    And admin tooling reading the personal-project context still sees
        all four data shapes (used by support / debugging / migration)

  # ---------------------------------------------------------------------------
  # Reversibility — disable behavior per feature
  # ---------------------------------------------------------------------------

  @bdd @data @personal-workspace @reversibility
  Scenario: Reversibility policy on bundle disable
    Given the user has the bundle enabled with rows in all four features
    And the user authored:
      | feature       | row-count + state                                    |
      | datasets      | 3 datasets, 50 rows                                  |
      | evaluations   | 2 completed eval runs + 1 in-progress                |
      | annotations   | 12 annotations attached to traces                    |
      | automations   | 1 active scheduled automation + 1 paused             |
    When the user disables the bundle
    Then per-feature behavior is:
      | feature       | rule                                                                                |
      | datasets      | rows persist; nav hides; re-enable shows them again, intact                         |
      | evaluations   | in-progress run completes naturally; no new runs accepted; completed runs archived  |
      | annotations   | rows persist (annotations are trace-attached, not feature-attached); nav hides      |
      | automations   | active automations PAUSE; user is warned at re-enable to confirm-resume each one    |
    And no row is deleted on disable
    And re-enable rehydrates the four nav entries with state intact (paused
        automations stay paused until user explicitly resumes them per
        the warn-at-re-enable rule)

  @bdd @data @personal-workspace @reversibility
  Scenario: Re-enable shows existing rows, paused automations, and a one-time confirmation card
    Given the user previously enabled then disabled the bundle, leaving
        artifacts behind per the policy table above
    When the user re-enables
    Then the sidebar re-shows the four entries
    And the Automations page renders a one-time confirmation card listing
        each paused automation with "Resume" / "Delete" actions
    And dismissing the card does NOT auto-resume the automations
        (explicit user action only — destructive default avoided)

  # ---------------------------------------------------------------------------
  # Audit-log
  # ---------------------------------------------------------------------------

  @bdd @audit @personal-workspace
  Scenario: Bundle enable / disable writes audit-log rows
    When the user toggles the bundle in /me/settings (either direction)
    Then exactly one audit-log row is written per toggle, shape:
      | field           | value                                                       |
      | actor.userId    | the user                                                    |
      | action          | "personalWorkspaceFeatures.enableAll" / "disableAll"         |
      | target.projectId| the user's Personal Project id                              |
      | metadata        | `{previousState, newState}` for forensic reconstruction     |
      | occurredAt      | server timestamp                                            |
    And the row is visible at /settings/audit-log to org admins (per
        the existing audit-log RBAC) AND to the user themselves on
        /me/settings → 'Activity' tab (so the user can self-audit)

  # ---------------------------------------------------------------------------
  # Self-trace visibility + cross-user isolation (covered in detail in
  # ingestion-attribution.feature; key invariants pinned here too)
  # ---------------------------------------------------------------------------

  @bdd @api @personal-workspace @isolation
  Scenario: User sees own traces in Traces Explorer scoped to their personal project
    Given the user has fired N completions through their Personal VK
    When the user opens /me Traces (the explorer mounted on the user's
        Personal Project)
    Then the explorer lists the user's own traces only
    And the explorer's scope is `projectId = personalProjectId` —
        project-URL-scoped, NOT a separate `workspaceUserId` predicate
        (the project IS the scope; `Project.ownerUserId` distinguishes
        personal projects from team / shared)

  # Backed by dbMultiTenancyProtection (Sergey's 67b0d229c + 80f3cf691):
  # every trace.getById walks WHERE-clauses for organizationId membership,
  # rejecting foreign reads at the Prisma middleware boundary. Pinned
  # @unimplemented for the parity gate until a scenario-specific
  # integration test gets added under traces.integration.test.ts.
  @bdd @api @personal-workspace @isolation @regression @unimplemented
  Scenario: Cross-user read isolation — foreign trace.getById returns NOT_FOUND
    Given two users with separate Personal Projects and separate traces
    When user A direct-pastes user B's trace URL or calls
        `trace.getById({ traceId: <userB-trace> })`
    Then the call returns NOT_FOUND (404 / tRPC NOT_FOUND), not a redacted view
    And no part of user B's trace shape is leaked
    And the failure mode is identical regardless of whether the trace
        exists, doesn't exist, or belongs to another user (no enumeration
        side-channel)

  # Guarded by existing project-guard middleware (DashboardLayout +
  # dbOrganizationIdProtection) which rejects foreign-project IDs at
  # request time. End-to-end behaviour captured in cross-org Phase 5
  # smoke (#160) and persona-aware-chrome regressions; pinned
  # @unimplemented for a dedicated scenario binding when the next
  # /me-namespace integration test pass lands.
  @bdd @ui @personal-workspace @isolation @regression @unimplemented
  Scenario: Cross-user direct-paste of foreign personal-project URL fails project-guard
    Given user A has Personal Project `personalProjectIdA`
    And user B has Personal Project `personalProjectIdB`
    When user A direct-pastes `/[personalProjectSlugB]/traces` or
        `/me/traces` rendered with `?projectId=personalProjectIdB`
    Then the existing project-guard middleware rejects (redirect or 403)
        — user A is NOT a member of personalProjectIdB, the guard fires
        the same as for any other foreign-project access
    And user B's traces are not enumerable through the URL fuzzing
        side-channel (Project lookup itself respects org-id scoping
        per the multitenancy guard in `dbOrganizationIdProtection.ts`)

  # ---------------------------------------------------------------------------
  # Persona regression invariants — features gating only applies to personal
  # ---------------------------------------------------------------------------

  # Personas resolver (PersonaResolverService) routes non-personal
  # projects through the full sidebar without consulting the personal
  # feature bundle; verified end-to-end in P10 cleanup + browser-QA
  # rounds. @unimplemented until a render-level persona-routing test
  # asserts the negative case (full library visible on non-personal).
  @bdd @ui @personal-workspace @regression @unimplemented
  Scenario: Team / project-shared workspaces are unaffected by personal-features gating
    Given a user with team-membership + project-shared workspaces
    When they navigate to a non-personal project
    Then the full library (Evaluations / Datasets / Annotations / Automations
        / Optimization Studio) is visible by default
    And no `personalFeatures`-style gating applies to non-personal scopes
    And the only surface that uses the bundle predicate is /me + the
        user's own Personal Project context
