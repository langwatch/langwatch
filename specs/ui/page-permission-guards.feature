# Implementation:
#   packages/browser/src/ui-module-screens.ts (the router's guard)
#   modules/*/browser/src/*.web.ts (each screen's `requires` and `flags`)
# Test: apps/ui/src/shell/__tests__/page-guards-follow-main.unit.test.ts

Feature: Every page main guarded is guarded the same way on the branch
  Main wrapped these pages in withPermissionGuard or withFeatureFlagGuard. The
  move into modules dropped the wrappers, so a reader without the grant opened
  the page. Each screen now declares main's grant or flag and the router guards
  it (ARCHITECTURE.md section 10).

  @unit
  Scenario: Every page main guarded declares main's grant and flags
    Given the table of pages main guarded, with main's grant and flags
    When each page's declaration is read from the installed modules
    Then it names the same grant and the same flags as main

  @unit
  Scenario: A reader without a page's grant is refused and told the grant
    Given a page main guarded on a grant
    When a reader without that grant opens it
    Then the router refuses them and names the grant

  @unit
  Scenario: A reader holding a page's grant opens it
    Given a page main guarded on a grant
    When a reader holding that grant opens it
    Then the page opens

  @unit
  Scenario: A page behind a release flag that is off does not exist
    Given a page main put behind a release flag
    When the flag is off for the reader
    Then the router answers not found, even to a reader holding the grant
