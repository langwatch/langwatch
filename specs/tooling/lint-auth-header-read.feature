Feature: The auth-header-read lint rule
  The door reads the auth headers (`authorization`, `x-auth-token`,
  `x-api-key`, `x-project-id`) and resolves the caller. A module's transport,
  app or `*.module.ts` file naming one is a bypass. The rule accepts a disable
  that states why the framework cannot express the case.

  @unit
  Scenario: An auth header read in a transport is reported
    Given a module transport that reads the X-Auth-Token header
    When the auth-header-read rule runs over it
    Then it reports authHeader with the lower-cased header

  @unit
  Scenario: An auth header read in a module file is reported
    Given a module file that reads the X-Auth-Token header
    When the auth-header-read rule runs over it
    Then it reports the read

  @unit
  Scenario: An auth header named in a type is not this rule's business
    Given a module app file whose type union names "authorization"
    When the auth-header-read rule runs over it
    Then it reports nothing

  @unit
  Scenario: A service naming an auth header is not this rule's business
    Given a module service that reads the X-Auth-Token header
    When the auth-header-read rule runs over it
    Then it reports nothing

  @unit
  Scenario: An auth header named by a key or a member is reported
    Given a module transport naming authorization as an object key and a member, and x-api-key in a plain template
    When the auth-header-read rule runs over it
    Then it reports each, and nothing for a computed member

  @unit
  Scenario: The scope header a permission declares is not this rule's business
    Given a module transport whose `.withPermission` names x-project-id as the header the door reads the scope from
    When the auth-header-read rule runs over it
    Then it reports nothing

  @unit
  Scenario: The module that binds the door is not this rule's business
    Given an auth module transport that reads the X-Auth-Token header
    When the auth-header-read rule runs over it
    Then it reports nothing, as credential-reader-owner exempts the same owners
