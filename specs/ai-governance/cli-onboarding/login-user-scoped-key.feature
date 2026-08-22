Feature: CLI login mints a user-scoped API key that inherits the user's permissions

  A user who signs in with `langwatch login` (device-session flow) today only
  receives their personal project's legacy API key. An org admin can therefore
  not read traces from any other project through the CLI, even though the web
  app grants them that access.

  The device-session approval now mints a scoped `ApiKey` owned by the
  approving user. Its role bindings and permission list are selected on the
  authorize screen, default to the widest access the user holds minus
  organization-management permissions, and are always intersected with the
  owner's live permissions at request time. This lets `langwatch projects list`
  and `langwatch trace search --project <id|slug>` reach every project the user
  can see, while a leaked key can never create projects, manage RBAC, or mint
  other keys unless the user opted in.

  Pairs with:
    - specs/ai-governance/cli-onboarding/login-unified.feature      (CLI login UX)
    - specs/ai-governance/cli-onboarding/authorize-project-picker.feature
    - specs/api-keys/unified-api-keys.feature                       (ApiKey + ceiling model)
    - specs/typescript-sdk/cli-cross-project-access.feature         (CLI side)

  Background:
    Given a user who is a member of an organization
    And the organization has governance enabled (`release_ui_ai_governance_enabled`)
    And a pending device code with credential_type "device_session"

  # ─────────────────────────────────────────────────────────────────────
  # Authorize screen defaults
  # ─────────────────────────────────────────────────────────────────────

  Rule: the authorize screen preselects the widest scope the user holds

    @integration
    Scenario: org admin defaults to organization scope
      Given the user holds an ORGANIZATION-scoped ADMIN role binding
      When the user opens the authorize screen for the device code
      Then the scope selection defaults to the whole organization
      And the permission selection defaults to every permission except the
        organization-management set

    @integration
    Scenario: regular member defaults to their own teams plus personal workspace
      Given the user is an org MEMBER who belongs to two shared teams
      When the user opens the authorize screen for the device code
      Then the scope selection defaults to those two teams and the user's
        personal workspace
      And the whole-organization scope is not selected

    @integration
    Scenario: the organization-management permissions are off by default
      When the user opens the authorize screen for the device code
      Then "organization:manage", "organization:delete", "project:create",
        "project:delete" and "team:manage" are not part of the default
        permission list
      And a key holding "project:manage" still cannot create or delete a
        project, so the exclusion holds in effect and not only in the list
      And gateway permissions (virtual keys, budgets, providers, routing
        policies) and "project:manage" (model providers, project settings)
        are part of the default permission list

  Rule: the user can customize scopes and permissions before approving

    @integration
    Scenario: narrowing the selection narrows the minted key
      Given the user deselects everything except one shared project
      And sets the permission level for traces to read only
      When the user approves and the CLI exchanges the device code
      Then the minted key has exactly one PROJECT-scoped binding for that project
      And its permission list contains "traces:view" but not "traces:update"

    @integration
    Scenario: approval with zero scopes selected is refused
      Given the user deselects every scope on the authorize screen
      Then the approve action is unavailable
      And an approve request carrying zero bindings is refused with a handled
        error naming the bindings field

  # ─────────────────────────────────────────────────────────────────────
  # Minting mechanics
  # ─────────────────────────────────────────────────────────────────────

  Rule: the key is minted at exchange time, owned by the user, ceiling-capped

    @integration
    Scenario: exchange returns a user-owned scoped key
      Given the user approved the device code with the default selection
      When the CLI polls the exchange endpoint
      Then the response carries a `cli_api_key` in the `sk-lw-{lookupId}_{secret}` format
      And the ApiKey row records the approving user as owner
      And its permissionMode is "restricted" with the selected permission list
      And the response still carries the personal project and its API key,
        so older CLI versions keep working unchanged

    @integration
    Scenario: an approval that is never exchanged mints nothing
      Given the user approved the device code
      But the CLI never polls the exchange endpoint before the code expires
      Then no ApiKey row is created for this login

    @integration
    Scenario: the key can never exceed the owner's live permissions
      Given a minted CLI key whose bindings cover the whole organization
      And the owner is later demoted from org ADMIN to MEMBER
      When the key is used to search traces on a project the owner can no
        longer view
      Then the request is refused with a 403

    @integration
    Scenario: access lost between approve and exchange ends the login
      Given the user approved the device code
      But the user loses the access the selection was approved against before
        the CLI polls the exchange endpoint
      When the CLI polls the exchange endpoint
      Then the response is a fatal "access_denied" telling the user to log in
        again
      And the device code is gone, so the next poll cannot re-run the mint

    @integration
    Scenario: approve refuses bindings above the approving user's ceiling
      Given the user is an org MEMBER of one team
      When an approve request claims an ORGANIZATION-scoped binding
      Then the approval is refused with a handled error
      And no selection is stamped on the device code

  Rule: re-login and logout do not accumulate keys

    @integration
    Scenario: re-login from the same device replaces the previous CLI key
      Given the user already holds a CLI key minted for device label "my-laptop"
      When the user logs in again from "my-laptop" and completes the exchange
      Then the previous CLI key for that device label is revoked
      And exactly one active CLI key remains for that user and device label

    @integration
    Scenario: logout revokes the CLI key
      Given the user holds an active CLI key from this login
      When the CLI calls the logout endpoint
      Then that CLI key is revoked along with the device session tokens

  # ─────────────────────────────────────────────────────────────────────
  # Project listing honours the key's reach
  # ─────────────────────────────────────────────────────────────────────

  Rule: GET /api/projects returns exactly the projects the credential can view

    @integration
    Scenario: org-scoped key lists every project in the organization
      Given a CLI key with an ORGANIZATION-scoped binding granting "project:view"
      When the key calls GET /api/projects
      Then the response lists every non-archived project in the organization

    @integration
    Scenario: project-scoped key gets a filtered list, not a refusal
      Given a CLI key bound to two of the organization's five projects
      When the key calls GET /api/projects
      Then the response lists exactly those two projects
      And the response is a 200, not a 403

    @integration
    Scenario: a key without project:view gets an empty list, not a refusal
      Given a CLI key bound to one team but carrying only "traces:view"
      When the key calls GET /api/projects
      Then the response is a 200 with an empty list and a total of zero

    @integration
    Scenario: the filtered list respects the owner's ceiling
      Given a CLI key bound to the whole organization
      And the owner has meanwhile lost access to one team's projects
      When the key calls GET /api/projects
      Then that team's projects are absent from the response
