Feature: Enterprise gateway routing policies and personal virtual keys
  Routing policies and personal virtual keys are Enterprise-licensed subjects, so they live in the
  enterprise gateway module and never in core gateway or governance (ARCHITECTURE.md section 3).
  The wire is main's: routingPolicy.* and personalVirtualKeys.*.

  @unit
  Scenario: The enterprise gateway serves routing policies and personal virtual keys
    Given the enterprise gateway module is installed
    Then it declares the routingPolicy and personalVirtualKeys namespaces

  @unit
  Scenario: The enterprise gateway boots over memory stores and answers from its own routing policies
    Given the enterprise gateway is installed over memory stores
    When governance counts an organization's routing policies
    Then the enterprise gateway answers from its own table

  @unit
  Scenario: Core gateway serves neither routing policies nor personal virtual keys
    Given the core gateway module is installed
    Then it declares neither the routingPolicy nor the personalVirtualKeys namespace

  @unit
  Scenario: Governance serves neither routing policies nor personal virtual keys
    Given the governance module is installed
    Then it declares neither the routingPolicy nor the personalVirtualKeys namespace

  @unit
  Scenario: No personal virtual key is issued while an operator acts as another member
    Given an operator acting as a member through impersonation
    When they issue a personal virtual key in the member's organization
    Then the issue is refused with permission_denied before membership is read

  # main's user.personalContext, served where the routing policies live. It is
  # a cached read, so it never carries a credential: the page mints a personal
  # access token instead of revealing a key.
  @unit
  Scenario: The enterprise gateway serves the personal context under organization:view
    Given a signed-in member of an organization
    When they read routingPolicy.personalContext for that organization
    Then organization:view is asked before the application is reached
    And the answer is main's user.personalContext body for the caller

  @unit
  Scenario: The personal context never carries the personal project's API key
    Given a member of the organization, with or without project:manage on their personal project
    When they read their personal context in that organization
    Then the personal project's API key is blank
    And the blank key is a valid personal context on the wire

  @unit
  Scenario: The personal context names the default routing policy the enterprise gateway resolves
    Given a member whose personal team inherits a default routing policy
    When they read their personal context in that organization
    Then the personal context names that routing policy

  @unit
  Scenario: A caller outside the organization is refused their personal context
    Given a signed-in person who is not a member of the organization
    When they read their personal context in that organization
    Then the read is refused with user_not_in_organization
    And no personal workspace is provisioned for them
