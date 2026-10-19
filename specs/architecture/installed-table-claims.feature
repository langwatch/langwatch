@adr-134
Feature: Installed modules claim each table once in every repository tier
  As the team shipping the npx server and the hosted processes
  I want every installed module's table claims checked as boot checks them, for both tiers
  So that a module claiming a table it only reads fails a unit test, not `task upgrade` in production

  # Boot asserts ownership over the tier it was given; the installation tests boot the memory
  # tier, so a live-tier double claim reached production (npx-server-smoke, 2026-10-07).
  # A reader of a shared table claims nothing: it holds a plain unclaimed class (R40).

  @unit
  Scenario Outline: Every installed module's <tier> tier claims each table once
    Given every module the tasks process installs
    When their <tier> repository claims are checked as boot checks them
    Then no table is claimed by two modules
    Examples:
      | tier   |
      | live   |
      | memory |

  @unit
  Scenario: A table claimed by two installed modules fails naming the table and both claimants
    Given every module the tasks process installs
    And one more module claims a table an installed module owns
    When their live repository claims are checked as boot checks them
    Then the check fails naming the store, the table and both claimants
