Feature: CLI login never lands a user on a personal project

  A customer used the LangWatch coding-assistant skills to set up experiments. Their
  agent ran `langwatch login`, which signed them into a personal project, and the
  evaluations they then created were sent to that personal project, confusing, and
  wrong for shared / team work. Two backend guards make this impossible, paired with
  the CLI-side default-to-project behavior:

    1. The device-session (AI-tools) login provisions a personal workspace + personal
       virtual key. That is a governance-plane feature; for an organization without
       governance enabled it must be refused, with a message pointing at project login.
    2. The project-login (project_api_key) flow must target a real, shared project. The
       browser picker hides personal projects, the approval endpoint rejects a personal
       project id, and the picker defaults to the last project the user worked in.

  Pairs with:
    - specs/ai-governance/cli-onboarding/login-unified.feature  (CLI-side default-to-project)

  Background:
    Given a user who is a member of an organization
    And the CLI device-code approval endpoint `POST /api/auth/cli/approve`
    And governance for an organization is gated by the `release_ui_ai_governance_enabled` feature flag

  Rule: device-session (AI-tools) login requires governance enabled

    @integration @governance-gate
    Scenario: device-session approval is refused when governance is disabled
      Given governance is disabled for the organization
      And a pending device code with credential_type "device_session"
      When the user approves it
      Then the response is 403 with error "governance_required"
      And no personal virtual key is minted for the user

    @integration @governance-gate
    Scenario: device-session approval succeeds when governance is enabled
      Given governance is enabled for the organization
      And a pending device code with credential_type "device_session"
      When the user approves it
      Then the response is 200 and a personal virtual key is issued

  Rule: project login targets a real project, never a personal one

    @integration @project-picker
    Scenario: project-login approval rejects a personal project id
      Given a pending device code with credential_type "project_api_key"
      And the user has a personal project and a shared team project
      When the user approves with the personal project's id
      Then the response is 400 with error "personal_project_not_allowed"
      And the personal project's API key is NOT returned

    @integration @project-picker
    Scenario: project-login approval returns the shared project's key
      Given a pending device code with credential_type "project_api_key"
      When the user approves with the shared team project's id
      Then the response is 200 and returns that project's API key

    @unit @project-picker
    Scenario: the project picker omits personal and internal-governance projects
      Given an org team with a personal project, an internal-governance project, and a shared project
      When the CLI-auth project list is resolved
      Then only the shared project is offered

    @unit @project-picker @last-project
    Scenario: the project picker pre-selects the user's last project when it is offered
      Given the resolved project list contains the user's last project "acme-prod"
      When the CLI-auth project default is computed
      Then "acme-prod" is the pre-selected project
