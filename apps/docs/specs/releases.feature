Feature: Useful release updates in the documentation
  Published release notes sit beside the configured docs.json announcement.

  @unit
  Scenario: Read published release notes
    Given the repository changelog has dated releases and an unreleased section
    When the site reads release notes at build time
    Then it selects the five newest published releases
    And the latest summary comes from its features or fixes
    And version, date and full notes link to the changelog page
    And the changelog page shows those notes and links on to the self-hosting upgrade notes
    And missing or invalid notes produce no announcement

  @unit
  Scenario: Show what is new on the home page
    Given the repository changelog has published releases
    When the introduction page is built
    Then a "What's new" section lists the three newest releases with version, date and summary
    And each version and a closing link open the changelog
    And without release notes the section is left out

  @e2e
  Scenario: Read and dismiss a release update
    Given a guide displays the latest release version and date
    Then the update fits one line at desktop and phone widths in both themes
    And it is static with or without reduced motion
    And the release link opens the matching notes on the changelog page
    And the announcement sits on a tinted ground while the release update stays on paper
    And both dismiss buttons are the same compact size and line up
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

  @unit
  Scenario: Read release notes without repeated commit links
    Given a release note that links its pull request and the commit it merged as
    When the changelog page and its Markdown export are built
    Then the note keeps the pull request link and drops the commit link beside it
    But a note whose only link is its commit keeps that link
    And the changelog's Markdown export fits the page token budget agents read within
