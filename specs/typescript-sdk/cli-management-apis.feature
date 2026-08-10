Feature: CLI families for the management APIs
  Everything the management REST surface exposes is operable from the langwatch
  CLI with an organization API key, so an administrator or a coding agent runs
  the whole provisioning flow without a browser: the organization itself,
  members, invites, teams, groups, custom roles, role bindings, SCIM tokens and
  the access an API key carries.

  Background:
    Given LANGWATCH_API_KEY is configured

  Rule: Every management family is operable from the CLI

    @unit
    Scenario: The organization commands cover get and update
      When I read the command catalog the CLI publishes
      Then the organization family carries get and update
      And update accepts the organization name

    @unit
    Scenario: The members commands cover the membership lifecycle
      When I read the command catalog the CLI publishes
      Then the members family carries list, get, update, disable, enable, remove and access
      And update accepts the organization role to set

  Rule: Flags carry the shapes the management APIs accept

    @unit
    Scenario: Invites are created from flags and from a JSON file
      When invites are created from repeated email, role and team flags
      Then each team flag resolves to a team and the role held on it
      And the same batch can be given as JSON on a file or on standard input
      And both forms produce the same request

    @unit
    Scenario: Repeated permission flags compose into one permission set
      When a permission flag is repeated with several resource and action pairs
      Then they compose into a single permission set in the order given
      And a value that is not a resource and action pair is refused, naming the expected shape

    @unit
    Scenario: A page size the request cannot carry exactly is refused
      When a paging flag is given a number too large to be counted exactly
      Then the CLI refuses it by name instead of sending a different number

    @unit
    Scenario: A binding flag parses role, scope type and scope id
      When a binding flag is parsed
      Then the role, the scope type and the scope id are read out of it
      And a malformed value is refused, naming the expected shape

    @unit
    Scenario: Role bindings list passes principal and scope filters through
      When role bindings are listed with a principal type, a principal id and a scope
      Then every filter reaches the request unchanged
      And omitted filters are absent from the request rather than sent empty

    @unit
    Scenario: Role bindings update changes the role a binding grants
      When a role binding is updated with a new role
      Then the request patches that binding with the role
      And a custom role id rides along only when one is given

    @unit
    Scenario: A mistyped invite email is refused before the batch is sent
      When an invite carries an address that is not an email
      Then the CLI refuses the batch, naming the address and the shape expected
      And it makes no request, so no other invite in the batch is sent either

  Rule: Secrets and access changes are handled carefully

    @unit
    Scenario: A SCIM token is printed once with a save-it-now warning
      When a SCIM token is created
      Then the token value is printed
      And the output warns that it cannot be retrieved again

    @unit
    Scenario: API key update replaces bindings and sets restricted permissions
      When an API key is updated with repeated binding flags and restricted permissions
      Then the request replaces the key's bindings with exactly the ones given
      And it sets the permission mode to restricted with those permissions

    @unit
    Scenario: A key with no bindings is reported as granting no access
      Given an API key that holds no role bindings
      When the key is read or updated, in any permission mode
      Then the output says the key grants no access
      And it never describes the key as having organization-wide access
      And it offers the command that gives the key a binding

    @unit
    Scenario: A restricted key shows where its access comes from
      Given an API key in restricted mode with bindings and explicit permissions
      When the key is read or updated
      Then the output lists the permissions the key carries
      And it lists the bindings that grant them

    @unit
    Scenario: The instance family refuses to run without its credential
      Given no instance administrator credential is configured
      When an organizations command is run
      Then the CLI names the credential to set
      And it makes no request with an empty one

  Rule: Teams and groups get the families they never had

    @unit
    Scenario: Team commands cover the team lifecycle and membership
      When I read the command catalog the CLI publishes
      Then the teams family carries list, get, create, update and archive
      And it carries nested member commands to list, add and remove
      And adding a member accepts the role they get on the team

    # Permissions at a scope are the union of every role held there, so one
    # person can hold several. A listing that walks bindings would show them
    # once per role and count a two-role member as two people.
    @unit
    Scenario: A member holding several roles on a team is listed once
      Given a member holds both Member and Viewer on the same team
      When I list that team's members
      Then they appear on a single row carrying both roles
      And the count reports one member

    @unit
    Scenario: Group commands cover groups, membership and bindings
      When I read the command catalog the CLI publishes
      Then the groups family carries list, get, create, rename and delete
      And it carries nested member commands to list, add and remove
      And it carries nested binding commands to list, add and remove
      And adding a binding accepts a role, a custom role, a scope type and a scope id

  Rule: Output and failures are legible

    @unit
    Scenario: Every command returns the full API response as machine output
      When a management command succeeds
      Then the machine-readable output is the API response untouched
      And the human-readable output is a table over the same data

    @unit
    Scenario: A paginated listing reports the total, not the size of the page
      When a listing is asked for a page smaller than everything there is
      Then the success line reports how many there are in total
      And the page size the caller asked for does not change that number

    @unit
    Scenario: An enterprise plan failure explains the upgrade path
      Given the API refuses a management call because the plan is below Enterprise
      When the CLI reports the failure
      Then it explains that the feature needs an Enterprise plan and links the documentation
      And guidance sent by the server is preferred over the built-in wording

    @unit
    Scenario: A success carrying no body is not read as a parse failure
      Given a management family answers a delete with no content
      When the CLI reads the response
      Then the command succeeds rather than reporting a parse failure

    @unit
    Scenario: Every management command is covered by the feature map
      When I read the command catalog the CLI publishes
      Then every management command appears in the feature map
