Feature: The api package surface only shrinks
  `@langwatch/api` is being rebuilt to one declaration surface and one runtime
  per transport (dev/docs/plans/api-package-rebuild.md). Until then every
  source file it holds is listed in a baseline, so a lane cannot add a file to
  the legacy surface by accident, and a deleted file is removed from the list
  so it cannot come back.

  @unit
  Scenario: The api package accepts no new file outside the rebuild target
    Given the source files under packages/api/src, tests excluded
    When they are compared with the baseline and the rebuild target's file list
    Then a file in neither fails the check, naming it
    And a baseline entry with no file behind it fails the check until the baseline is regenerated
