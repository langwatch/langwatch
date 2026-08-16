Feature: CLI login never lands a user on a personal project

  A customer used the LangWatch coding-assistant skills to set up experiments. Their
  agent ran `langwatch login`, which signed them into a personal project, and the
  evaluations they then created were sent to that personal project, confusing, and
  wrong for shared / team work. Two backend guards make this impossible, paired with
  the CLI-side default-to-project behavior:

    1. The device-session (AI-tools) login provisions a personal workspace + personal
       virtual key. That is a governance-plane feature. Governance ships enabled by
       default (ADR-038 Decision 7), so the approval works out of the box on a fresh
       installation; for an organization whose governance flag has been switched off
       it must be refused, with a message pointing at project login.
    2. The project-login (project_api_key) flow targets a project the user chose
       DELIBERATELY. The hazard was silent AUTO-selection of a personal project, so:
       the browser picker lists the caller's personal project as an explicit,
       clearly-labelled entry (preselected only when the org has no shared projects,
       where it is the only sane target), the approval endpoint honours the caller's
       OWN personal project when explicitly picked, refuses anyone else's personal
       project outright, and the picker defaults to the last project the user worked
       in when shared projects exist.

  Pairs with:
    - specs/ai-governance/cli-onboarding/login-unified.feature  (CLI-side default-to-project)

  Background:
    Given a user who is a member of an organization
    And the CLI device-code approval endpoint `POST /api/auth/cli/approve`
    And governance for an organization is gated by the `release_ui_ai_governance_enabled` feature flag
    And the flag is enabled by default and can be switched off per organization

  Rule: device-session (AI-tools) login requires governance enabled

    @integration @governance-gate
    Scenario: device-session approval succeeds on a default installation
      Given no governance flag override is configured
      And a pending device code with credential_type "device_session"
      When the user approves it
      Then the approval is not refused by the governance gate
      And no personal virtual key is minted, even though the organization has
      a provider one could route to

    @integration @governance-gate
    Scenario: device-session approval is refused when governance is disabled
      Given governance has been switched off for the organization
      And a pending device code with credential_type "device_session"
      When the user approves it
      Then the response is 403 with error "governance_required"
      And no personal virtual key is minted for the user

    @integration @governance-gate
    Scenario: device-session approval succeeds when governance is enabled
      Given governance is enabled for the organization
      And a pending device code with credential_type "device_session"
      When the user approves it
      Then the response is 200

  Rule: project login targets a deliberately chosen project; another user's personal project is never one

    @integration @project-picker
    Scenario: project-login approval rejects another user's personal project id
      Given a pending device code with credential_type "project_api_key"
      And a personal project owned by a DIFFERENT user exists in the organization
      When the user approves with that personal project's id
      Then the response is 400 with error "personal_project_not_allowed"
      And that personal project's API key is NOT returned

    @integration @project-picker
    Scenario: project-login approval honours the caller's own explicitly picked personal project
      Given a pending device code with credential_type "project_api_key"
      And the user has a personal project and explicitly picked it in the browser
      When the user approves with their own personal project's id
      Then the response is 200 and returns that personal project's API key

    @integration @project-picker
    Scenario: project-login approval returns the shared project's key
      Given a pending device code with credential_type "project_api_key"
      When the user approves with the shared team project's id
      Then the response is 200 and returns that project's API key

    @integration @project-picker @rbac
    Scenario: project-login approval allows an org admin who is not a direct team member
      Given a pending device code with credential_type "project_api_key"
      And a shared project on a team the org admin does not directly belong to
      When the org admin who can write the project approves with its id
      Then the response is 200 and returns that project's API key

    @integration @project-picker @rbac
    Scenario: project-login approval denies a project the caller cannot write
      Given a pending device code with credential_type "project_api_key"
      And the caller lacks write access to the picked shared project
      When the user approves with that project's id
      Then the response is 403 with error "forbidden"
      And the project's API key is NOT returned

    @unit @project-picker
    Scenario: the project picker lists the caller's personal project explicitly and omits internal-governance projects
      Given an org team with a personal project, an internal-governance project, and a shared project
      When the CLI-auth project list is resolved
      Then the shared project is offered under its team
      And the personal project is offered as a separate, explicit personal entry
      And the internal-governance project is never offered

    @unit @project-picker @last-project
    Scenario: the project picker pre-selects the user's last project when it is offered
      Given the resolved project list contains the user's last project "acme-prod"
      When the CLI-auth project default is computed
      Then "acme-prod" is the pre-selected project
