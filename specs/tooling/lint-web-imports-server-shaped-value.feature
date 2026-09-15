Feature: The web-imports-server-shaped-value lint rule
  A package whose declarations describe a server does not belong in a browser
  program. One `better-auth/react` in a browser module put 576 declaration
  files into apps/ui, 251 of them a SQL query builder, and the only symptom was
  a slower type-check. The rule refuses the value import and leaves the type
  import alone, because a type is erased and never loads the graph behind it.

  Background:
    Given a workspace whose auth feature is at strict layout version 0

  @unit
  Scenario: A browser module value-importing a server-shaped package is reported
    Given a web feature module that value-imports a database query builder
    When the web-imports-server-shaped-value rule runs over it
    Then it reports serverShaped
    And the message names the package the module imported

  @unit
  Scenario: The rule covers apps/ui as well as the web feature packages
    Given a module in the browser application that value-imports a datastore client
    When the web-imports-server-shaped-value rule runs over it
    Then it reports serverShaped

  @unit
  Scenario: A type-only import of a server-shaped package is left alone
    Given a web feature module that imports the same package as a type
    When the web-imports-server-shaped-value rule runs over it
    Then it reports nothing

  @unit
  Scenario: The browser entrypoints better-auth ships stay allowed
    Given a browser module that imports the better-auth react client
    When the web-imports-server-shaped-value rule runs over it
    Then it reports nothing

  @unit
  Scenario: A browser module reaching better-auth's server half is reported
    Given a web feature module that value-imports better-auth itself
    When the web-imports-server-shaped-value rule runs over it
    Then it reports serverShaped

  @unit
  Scenario: Server code may value-import a server-shaped package
    Given a server feature module that value-imports better-auth
    When the web-imports-server-shaped-value rule runs over it
    Then it reports nothing

  @unit
  Scenario: A browser test may value-import a server-shaped package
    Given a test beside a web feature module that value-imports better-auth
    When the web-imports-server-shaped-value rule runs over it
    Then it reports nothing
