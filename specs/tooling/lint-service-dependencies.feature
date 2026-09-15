Feature: The service-dependencies lint rule
  A service depends on its own repository and on other services; it cannot
  import a database client directly, reach into another subject's
  repository, or recover the global application graph.

  @unit
  Scenario: A service importing a database client is reported
    Given a service module that imports a Prisma client directly
    When the service-dependencies rule runs over it
    Then it reports databaseClient

  @unit
  Scenario: A foreign repository import is reported with the specifier
    Given a service module that imports a repository it cannot resolve within its own package
    When the service-dependencies rule runs over it
    Then it reports foreignRepository with the import specifier

  @unit
  Scenario: A service's own repository import is left alone
    Given a service module that imports its own subject's repository
    When the service-dependencies rule runs over it
    Then it reports nothing

  @unit
  Scenario: Recovering the global application from a service is reported
    Given a service module that imports the global application accessor
    When the service-dependencies rule runs over it
    Then it reports globalApplication
