Feature: The API's Enterprise application slot, member by member

  The API process reads eight independent Enterprise members off one slot: the licence
  store, the SCIM application, the usage-limit store, the governance capability, the
  governance application, the session-policy store, the webhook application and the
  operator's single sign-on back office. They do not share a graph, so a deployment that
  can serve three of them must serve three rather than none, and a customer who reaches a
  member this deployment does not have must be told which one.

  Background:
    Given an API process composing its own graph

  @unit
  Scenario: The session rules are composed over the process's own database
    Given the process holds a database connection
    When the Enterprise application is composed
    Then the session-policy member is present
    And an organization's session rules can be read and set

  @unit
  Scenario: The webhook application is composed with its delivery health
    Given the process holds a database connection and the stored-secret cipher
    When the Enterprise application is composed
    Then the webhook member is present
    And one endpoint's delivery health can be read

  @unit
  Scenario: A test fire refuses because this process delivers nothing
    Given the process composed the webhook application
    When a test fire is dispatched to an endpoint
    Then the refusal names the delivery process manager the API does not run

  @unit
  Scenario: The operator's connection back office is composed
    Given the process holds a database connection and a queue
    When the Enterprise application is composed
    Then the single sign-on back-office member is present
    And the operator can list this deployment's connections

  @unit
  Scenario: A process with no queue composes no connection ledger
    Given the process holds a database connection and no queue
    When the Enterprise application is composed
    Then the single sign-on back-office member is absent
    And the other composed members are unaffected

  @unit
  Scenario: A process with no database composes no member at all
    Given the process holds no database connection
    When the Enterprise application is composed
    Then every member is absent

  @unit
  Scenario: An absent member refuses under its own name
    Given the process composed the session-policy member and no governance capability
    When a customer opens the governance console
    Then the refusal names the governance capability
    And reading an organization's session rules still answers

  @unit
  Scenario: An absent usage-limit store rejects rather than throwing at the caller
    Given the process composed no usage-limit store
    When an organization reaches a resource limit
    Then the notification refuses by name on the returned promise
    And the action that reached the limit is not failed by the missing notifier

  @unit
  Scenario: The single sign-on back office refuses by name with no ledger composed
    Given the process composed no single sign-on back-office member
    When an operator opens the back office
    Then the refusal names the single sign-on ledger
