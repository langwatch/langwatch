Feature: Governance navigation names what the pages show
  As an administrator reading the governance sidebar
  I want one name per concept and addresses that outlive renames
  So that I find things once and old links never die

  # The governance sidebar grows around the analytics it fronts: Inventory
  # unifies the tool catalog and the ingestion sources under one roof,
  # Departments becomes People because the page is about the people in the
  # organization rather than its billing dimension, and two spend views
  # arrive behind their own switch so unfinished UI never reaches an org
  # that did not ask for it. Every rename keeps the old address alive as a
  # redirect, because bookmarks and stored pins do not read changelogs.

  Background:
    Given the governance sidebar and its routes

  @unit
  Scenario: The sidebar names People where it named Departments
    Given the governance layout renders its navigation items
    When the item lists are captured
    Then the item naming the organization's people points at /governance/people
    And no item points at /governance/departments any more

  @unit
  Scenario: Old departments bookmarks land on the people page
    Given a reader opens /governance/departments from a bookmark
    And the chained /governance/cost-centers address from an older bookmark
    When both addresses are resolved by the mounted routes
    Then both land on /governance/people

  @unit
  Scenario: Every internal link follows the rename
    Given the application source tree
    When every navigation link to a renamed governance page is inspected
    Then links name the current address
    And only the compatibility maps and the redirect itself still carry the old one

  @unit
  Scenario: An admin in an empty organization still reaches the renamed page
    Given the org-scoped pages an administrator may open without a project
    When the allowlist is read
    Then the people page is on it under its new address

  @unit
  Scenario: The sidebar offers Inventory as one door instead of two
    Given the governance layout renders its navigation items
    When the item lists are captured
    Then exactly one item names Inventory and points at /governance/inventory
    And no item points at the retired tool-catalog or ingestion-sources list addresses

  @unit
  Scenario: Old catalog addresses land on the matching inventory tab
    Given a reader opens /governance/tool-catalog or /governance/ingestion-sources from a bookmark
    When both addresses are resolved by the mounted routes
    Then each lands on /governance/inventory with its view's tab selected
