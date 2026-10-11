Feature: Useful release updates in the documentation
  Published release notes replace the repeated Skills announcement.

  @unit
  Scenario: Read published release notes
    Given the repository changelog has dated releases and an unreleased section
    When the site reads release notes at build time
    Then it selects the two newest published releases
    And the latest summary comes from its features or fixes
    And version, date and full notes link to the releases page
    And missing or invalid notes produce no announcement

  @e2e
  Scenario: Read and dismiss a release update
    Given a guide displays the latest release version and date
    Then the update fits one line at desktop and phone widths in both themes
    And it is static with or without reduced motion
    And the release link opens the matching notes in the docs
    When the reader dismisses the update
    Then it stays dismissed on another page and after reloading
    But a different release is shown again
    And dismissal still works when preference storage is unavailable

  @e2e
  Scenario: Find contextual agent setup
    Given a reader opens a guide
    When they follow the sidebar coding-agent setup link
    Then the coding-agent quickstart opens
    And the launcher remains available on the home page and API reference
