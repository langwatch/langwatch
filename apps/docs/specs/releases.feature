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
  Scenario: Keep the changelog Markdown export within the page token budget
    Given the newest published releases are together longer than the agent readiness page token budget
    When the changelog's Markdown export is built
    Then it keeps the newest releases only while the built export stays within the budget
    And when even the newest release alone is over the budget, it keeps no release
    And a short headed note under the kept releases says the others are left out and links to every release
    But the changelog page still shows every published release

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
    And while a docs announcement the reader can dismiss shows, the release update waits behind it, so one notice line shows at a time
    But an announcement the reader cannot dismiss leaves the release update in view
    And the announcement sits on a tinted ground while the release update stays on paper
    When the reader dismisses the update
    Then it stays dismissed on another page and after reloading
    But a different release is shown again
    And dismissal still works when preference storage is unavailable

  @e2e
  Scenario: Find contextual agent setup
    Given a reader opens an Observability guide
    When they follow the sidebar coding-agent setup link
    Then the coding-agent quickstart opens
    And the launcher remains available on the other Observability pages

  @unit
  Scenario: Read release notes without repeated commit links
    Given a release note that links its pull request and the commit it merged as
    When the changelog page and its Markdown export are built
    Then the note keeps the pull request link and drops the commit link beside it
    But a note whose only link is its commit keeps that link
