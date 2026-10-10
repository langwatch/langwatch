Feature: CLI grants, the successor to role bindings
  The grants family (/api/grants) replaces role bindings. The CLI operates it
  with an organization API key, lists roles with or without the built-in ones,
  and tells anyone still using `langwatch role-bindings` where to go instead.
  A grant reaches only as far as the caller's own permissions, so a refusal
  names the permissions the caller lacks.

  Background:
    Given LANGWATCH_API_KEY is configured

  Rule: The grants family is operable from the CLI

    @unit
    Scenario: The grants commands cover the grant lifecycle
      When I read the command catalog the CLI publishes
      Then the grants family carries list, get, create, change-role and revoke
      And every grants command is declared in the feature map

    @unit
    Scenario: Grants list sends its filters in the grants family's spelling
      When I list grants for api-key "key_1" on scope type "PROJECT" with status "active"
      Then the request asks /api/v1/grants/latest with principalType "apiKey" and scopeType "project"
      And a filter I did not give is absent from the request

    @unit
    Scenario: Grants list names the cursor of the next page
      Given the page returned carries a next cursor
      When I list grants
      Then the cursor to pass for the next page is printed

    @unit
    Scenario: Grants create sends the principal, role and scope, and the idempotency key
      When I create a grant of role "member" to user "user_1" on team "team_1" with an idempotency key
      Then the request posts the principal, the role id and the lowercase scope
      And the Idempotency-Key header carries the key

    @unit
    Scenario: Grants change-role sends only the new role
      When I change grant "grant_1" to role "viewer"
      Then the request patches that grant with the role id alone

    @unit
    Scenario: Grants revoke deletes the grant
      When I revoke grant "grant_1"
      Then the request deletes that grant

    @unit
    Scenario: A scope type the grants family does not know is refused before any request
      When I create a grant on scope type "workspace"
      Then the command fails naming organization, team and project
      And no request is made

    @unit
    Scenario: Roles list narrows to the built-in or the custom roles
      When I list roles with --built-in, then with --no-built-in, then with neither
      Then the requests carry builtIn "true", then "false", then no builtIn filter

  Rule: A refused escalation names what the caller lacks

    @unit
    Scenario: An escalation refusal lists the missing permissions
      Given the platform refuses a grant with grant_exceeds_caller_permissions
      When the refusal is rendered for a person
      Then the missing permissions are listed as words, not JSON
      And the advice says to grant only what I hold or to ask someone who holds it

  Rule: The role bindings commands are deprecated

    @unit
    Scenario: A role bindings command warns on stderr that grants supersede it
      When I run a role-bindings command
      Then stderr carries one warning naming `langwatch grants` and the grants API
      And stdout carries only the command's own output

    @unit
    Scenario: A grants command carries no deprecation warning
      When I run a grants command
      Then no deprecation warning is written
