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
