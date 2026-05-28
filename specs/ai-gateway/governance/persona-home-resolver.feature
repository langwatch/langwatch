Feature: Persona-aware home resolver
  When a user authenticates and lands on `/`, the resolver picks the right
  default home for their persona from {`/me`, `/[project]/messages`,
  `/governance`}. This is the apache2-floor demo wedge plus the
  must-not-break-existing-LLMOps-customers invariant from rchaves's
  directive 2026-04-29.

  The resolver is a pure function over four signals:
    1. `setupState.hasGovernanceIngest` — does this org have governance ingest?
    2. `setupState.hasPersonalVirtualKey` — does this user have a personal VK?
    3. `setupState.hasApplicationTraces` — does this org have application-origin spans?
    4. `user.hasOrganizationManagePermission` + `plan.isEnterprise` — combined gate
       for governance-admin landing (prevents accidental routing of LLMOps
       admins onto /governance).

  Plus an override: `User.lastHomePath` (when explicitly set by user pinning).

  Spec scope: the resolver function contract and its 4 personas. Implementation
  in `langwatch/src/server/governance/personaResolver.service.ts`. UI plumbing
  in `pages/index.tsx` via the existing client-side hook + redirect pattern
  (the Vite SPA architecture rarely uses `getServerSideProps`; the tRPC
  procedure `api.governance.resolveHome` runs the resolver server-side).

  Pairs with:
    - Phase 1B.5 in PR-3524 (Personal-Key Journey)
    - .monitor-logs/lane-b-jane-storyboard-ui-delta.md §2

  # ---------------------------------------------------------------------------
  # Persona 1 — Personal-only (just CLI users)
  # ---------------------------------------------------------------------------

  Scenario: Personal-only user → /me
    Given user "jane@acme.com" has a personal VirtualKey
    And the user belongs to no projects (no ProjectMember rows)
    And the org has no governance ingest (no IngestionSource)
    When the resolver runs for the user
    Then the resolver returns "/me"
    And the destination matches Persona 1 (personal-only)

  # ---------------------------------------------------------------------------
  # Persona 2 — Mixed (personal + project)
  # ---------------------------------------------------------------------------

  Scenario: User has personal VK + project membership → /me with WorkspaceSwitcher flip available
    Given user "alex@acme.com" has a personal VirtualKey
    And the user is a member of project "alex-team-prod" (has ProjectMember row)
    And the org has no governance ingest
    When the resolver runs for the user
    Then the resolver returns "/me"
    And the destination matches Persona 2 (mixed) — defaults to /me, WorkspaceSwitcher provides the project flip

  # ---------------------------------------------------------------------------
  # Persona 3 — Project-only LLMOps (the existing customer majority — DO NOT BREAK)
  # ---------------------------------------------------------------------------

  Scenario: Existing LLMOps customer with no governance + no personal-VK → /[project]/messages
    Given user "ben@acme.com" has NO personal VirtualKey
    And the user is a member of project "ben-team-prod"
    And the org has application traces (hasApplicationTraces=true)
    And the org has no governance ingest (hasGovernanceIngest=false)
    When the resolver runs for the user
    Then the resolver returns "/<projectSlug>/messages"
    And the destination matches Persona 3 (project-only LLMOps)
    And the resolver chose the user's first ProjectMember.project as the projectSlug

  Scenario: Org admin with no governance state stays on project (does not jump to /governance)
    Given user "carol@acme.com" has the "organization:manage" permission
    And the user is on the Enterprise plan
    But the org has NO governance ingest (hasGovernanceIngest=false)
    And the user has no personal VirtualKey
    And the user is a member of project "carol-team-prod"
    When the resolver runs for the user
    Then the resolver returns "/<projectSlug>/messages"
    And NOT "/governance"
    And the resolver explicitly avoids accidental governance-admin routing
      when the org has no governance state

  # ---------------------------------------------------------------------------
  # Persona 4 — Super-admin governance
  # ---------------------------------------------------------------------------

  Scenario: Org admin on Enterprise plan with governance ingest active → /governance
    Given user "carol@acme.com" has the "organization:manage" permission
    And the user is on the Enterprise plan
    And the org has governance ingest (hasGovernanceIngest=true)
    When the resolver runs for the user
    Then the resolver returns "/governance"
    And the destination matches Persona 4 (super-admin governance)

  # ---------------------------------------------------------------------------
  # User override
  # ---------------------------------------------------------------------------

  Scenario: A user-pinned lastHomePath wins over persona detection
    Given user "alex@acme.com" matches Persona 2 (mixed)
    And the user has explicitly pinned `User.lastHomePath = "/<projectSlug>/messages"`
    When the resolver runs for the user
    Then the resolver returns "/<projectSlug>/messages"
    And the persona-2 default is overridden by the user pin
    And the user can re-pin via /me/settings

  # ---------------------------------------------------------------------------
  # Fail-safe behaviour
  # ---------------------------------------------------------------------------

  Scenario: setupState query failure → resolver falls back to default project home
    Given the api.governance.setupState query throws on resolve
    And the user is a member of at least one project
    When the resolver runs for the user
    Then the resolver returns "/<firstProjectSlug>/messages"
    And the resolver does NOT crash
    And the LLMOps majority experience is preserved on transient backend errors

  Scenario: User has no project membership AND setupState fails → resolver falls back to /me
    Given the api.governance.setupState query throws on resolve
    And the user belongs to no projects
    When the resolver runs for the user
    Then the resolver returns "/me"
    And the resolver does NOT crash
    And the user lands on a usable surface even with no signals

  # ---------------------------------------------------------------------------
  # Integration with `pages/index.tsx`
  # ---------------------------------------------------------------------------

  Scenario: Authenticated user hits / → client-side query + redirect to resolver destination
    Given a user is authenticated
    And `api.governance.resolveHome` returns a destination path
    When the user navigates to "/"
    Then the existing LoadingScreen renders (same UX as today)
    And the client calls `api.governance.resolveHome`
    And the client `router.replace`s to the resolver destination
    And no other home is rendered before the redirect

  Scenario: Unauthenticated user hits / → existing /signin redirect, resolver does not run
    Given a user is not authenticated
    When the user navigates to "/"
    Then the existing signin redirect chain runs
    And the resolver does not execute
