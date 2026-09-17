Feature: The rest-no-error-handler-override lint rule
  `RestErrorHandler`, the per-namespace `onError` override, is banned
  outright - unlike the other REST handler rules, it carries no
  `publicRoute`/`RestRawResult` exemption. A handler always throws; the
  mount's own middleware serialises every response.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A type-only import of RestErrorHandler is reported
    Given a server file that imports the RestErrorHandler type only
    When the rest-no-error-handler-override rule runs over it
    Then it reports override

  @unit
  Scenario: A value import of RestErrorHandler alongside others is reported once
    Given a server file that imports RestErrorHandler as a value beside other names
    When the rest-no-error-handler-override rule runs over it
    Then it reports override exactly once

  @unit
  Scenario: A renamed import of RestErrorHandler is still reported
    Given a server file that imports RestErrorHandler under a local alias
    When the rest-no-error-handler-override rule runs over it
    Then it reports override

  @unit
  Scenario: Importing unrelated names from the rest package is not this rule's business
    Given a server file that imports only unrelated names from the rest package
    When the rest-no-error-handler-override rule runs over it
    Then it reports nothing

  @unit
  Scenario: RestErrorHandler outside a server package is not this rule's business
    Given a contract file that imports something named RestErrorHandler
    When the rest-no-error-handler-override rule runs over it
    Then it reports nothing
