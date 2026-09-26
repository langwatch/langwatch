Feature: Reorganizing gateway budgets per team from the CLI
  An organization moving from one organization-wide gateway budget to one
  budget per team creates teams, copies members into them, moves projects
  between teams, creates team budgets and raises the organization budget.
  Every step works from the CLI and the REST API, with no database access.

  Rule: A project moves to another team through the CLI and the REST API

    @unit
    Scenario: The CLI moves a project to another team
      Given a project "checkout" in team "Platform"
      When the user runs "langwatch projects move checkout --team Payments"
      Then the project update is sent with the team id of "Payments"
      And the output names the project and its new team

    @unit
    Scenario: The CLI refuses a move to a team that does not exist
      Given no team named "Nowhere" in the organization
      When the user runs "langwatch projects move checkout --team Nowhere"
      Then the command fails naming the team it could not find
      And no project update is sent

    @integration
    Scenario: A move to a team outside the organization or archived is refused
      Given a destination team that is archived or belongs to another organization
      When the project is moved to that team
      Then the move fails with project_destination_team_not_found
      And the project stays in its team

    @integration
    Scenario: A move across the personal workspace boundary is refused
      Given a shared project and a team that is someone's personal workspace
      When the project is moved across that boundary
      Then the move fails with personal_workspace_boundary
      And the project stays in its team

  Rule: Moving a project re-resolves the gateway budgets of its keys

    @integration
    Scenario: A team move tells the gateway to re-resolve the moved project's keys
      Given a project in team "Platform" with a virtual key sending traces to it
      When the project is moved to team "Payments"
      Then a gateway change is recorded for that project
      And the gateway drops the cached bundles of keys tracing to it

    @integration
    Scenario: An update that keeps the team records no gateway change
      Given a project in team "Platform"
      When the project is renamed, or updated with the team it already has
      Then no gateway change is recorded

  Rule: Budgets belong to the organization, so an organization key reaches them

    @unit
    Scenario: An organization key with no project lists the organization's budgets
      Given an organization API key bound at the organization with gatewayBudgets:view
      And the request names no project
      When it lists gateway budgets
      Then the permission is checked at the organization
      And the organization's budgets are returned

    @unit
    Scenario: A project key keeps reading budgets at its own project
      Given a key that resolved one project
      When it lists gateway budgets
      Then the permission is checked at that project

    @unit
    Scenario: A budget write is checked at the organization whatever key calls it
      Given a key that resolved one project
      When it creates, updates, archives or resets a budget
      Then the permission is checked at the organization

    @unit
    Scenario: A key without the budget permission is refused by permission, not as a bad key
      Given an organization API key that does not hold gatewayBudgets:view
      When it lists gateway budgets
      Then the request fails with permission_denied naming gatewayBudgets:view
      And the refusal is not invalid_credentials

    @integration
    Scenario: The budget routes take an organization key and hand its caller to the application
      Given the gateway budget routes mounted behind the key door
      When an organization key with no project lists and creates budgets
      Then the application authorizes the caller the key door resolved
      And a refused caller never reaches the budget write

  Rule: Updating a budget answers with its live spend

    @integration
    Scenario: A budget update answers with the spend the listing reports
      Given a budget whose ledger holds 100.14 USD of spend this window
      When the budget's limit is raised through the REST API
      Then the response carries spent_usd 100.14, not 0

  Rule: Team members can be copied in bulk

    @unit
    Scenario: Several users are added to a team in one command
      When the user runs "langwatch teams members add <team> <user-a> <user-b> <user-c>"
      Then each user is added to the team with the given role
      And the output lists every user added

    @unit
    Scenario: A new team copies the members of an existing team
      Given team "Platform" has three members with their own roles
      When the user runs "langwatch teams create Payments --copy-members-from Platform"
      Then team "Payments" is created
      And each member of "Platform" is added to "Payments" with the role they hold on "Platform"

    @unit
    Scenario: A bulk add reports the users it could not add
      Given one of the users cannot be added
      When several users are added to a team
      Then the other users are still added
      And the command fails naming the user that was not added and why

  Rule: A budget created mid-window says it counts from its creation

    @unit
    Scenario: The CLI notes that spend before creation is not counted
      When the user creates a gateway budget with the CLI
      Then the output says spend before the budget was created in the current window is not counted

    @integration
    Scenario: The budget creation drawer notes that spend before creation is not counted
      When a user opens the new budget drawer
      Then it says spend before the budget is created in the current window is not counted

  Rule: Management access on a CLI login key is opt-in
    A CLI login key leaves out organization:manage and team:manage.
    `langwatch login --device --management` asks for them, and the key gets
    only the ones the approving user holds. organization:delete is never on a
    CLI login key, with or without --management.

    @unit
    Scenario: A plain CLI login does not ask for management access
      When the user runs "langwatch login --device"
      Then the device code request does not ask for management access

    @unit
    Scenario: A CLI login with --management asks for management access
      When the user runs "langwatch login --device --management"
      Then the device code request asks for management access

    @unit
    Scenario: The approval screen shows management access when the CLI asked for it
      Given the CLI asked for management access
      And the approving user is an organization admin
      When the approval screen opens
      Then it shows one management access request listing what it adds
      And the approved key carries organization:manage and team:manage but not organization:delete

    @integration
    Scenario: Management access grants only the management permissions the user holds
      Given the CLI asked for management access
      And the approving user holds team:manage but not organization:manage
      When the approval is submitted
      Then the key carries team:manage and no other management permission

    @unit
    Scenario: Management access is refused to a user who holds no management permission
      Given the CLI asked for management access
      And the approving user holds none of the management permissions
      When the approval is submitted
      Then it fails with management_not_permitted
      And no key is minted

    @unit
    Scenario: A command refused for management access on a CLI login key names the re-login command
      Given the CLI login key does not carry a management permission
      When any command is refused for missing that permission
      Then the error suggests running "langwatch login --device --management"
