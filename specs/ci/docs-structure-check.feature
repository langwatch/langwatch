Feature: Docs structure check
  As a developer changing the documentation site
  I want CI to fail when a page becomes unreachable, a redirect dead-ends, or the docs name a release we no longer ship
  So that the published site cannot quietly drift away from the repository

  # Why this exists rather than leaning on the Mintlify CLI.
  #
  # `mint validate` builds the site and `mint broken-links` follows links, but a
  # page that no longer appears in any navigation group still builds, and
  # Mintlify still serves it at its URL. An unreferenced page is therefore not a
  # dead file — it is a live page nobody is maintaining, and nothing upstream
  # reports one. Three internal engineering notes were published that way.
  #
  # `mint broken-links --check-redirects` checks that a redirect destination
  # resolves, which leaves the case where the destination is itself another
  # redirect's source. Mintlify does not follow two hops, so the reader stops on
  # the intermediate path.
  Background:
    Given docscheck reads docs.json, the pages on disk, and the chart's appVersion
    And Mintlify serves every page file whether or not the navigation references it

  @unit
  Scenario: A page missing from the navigation is reported
    Given a page file exists on disk
    And no navigation group references it
    When docscheck runs
    Then it reports the page as published and unmaintained
    And the remedy offers moving an internal note under dev/docs/ instead

  @unit
  Scenario: A navigation entry with no page behind it is reported
    Given a navigation entry names a page
    And no .mdx or .md file exists for it
    When docscheck runs
    Then it reports the entry as missing its file

  @unit
  Scenario: One page reachable from two navigation groups is reported once
    Given the same page appears in two navigation groups
    When docscheck runs
    Then it reports the page once, with the number of times it appears

  @unit
  Scenario: A navigation entry written with a leading slash is reported
    Given a navigation entry starts with a slash
    And every other entry omits it
    When docscheck runs
    Then it reports the entry as inconsistent
    And it still resolves the entry to its file, so no missing-page finding is raised

  @unit
  Scenario: A redirect that lands on another redirect is reported
    Given a redirect destination is itself the source of another redirect
    When docscheck runs
    Then it reports the redirect as a chain
    And the remedy says to point it at the page the chain ends on

  @unit
  Scenario: A redirect that lands on nothing is reported
    Given a redirect destination is neither a page nor another redirect's source
    When docscheck runs
    Then it reports the redirect as a dead end

  @unit
  Scenario: An off-site redirect destination is left alone
    Given a redirect destination is an external URL
    When docscheck runs
    Then it raises no finding, because keeping that URL working is somebody else's job

  @unit
  Scenario: A release version the chart no longer ships is reported
    Given a page names a LangWatch image tag
    And the chart's appVersion is a different release
    When docscheck runs
    Then it reports the drift with the file and line
    And the remedy names the release the chart ships

  @unit
  Scenario: A version that is not a LangWatch release is left alone
    Given a page names a Kubernetes, Python, or Helm version
    When docscheck runs
    Then it raises no finding, because a check that fires on unrelated versions gets switched off

  @unit
  Scenario: A placeholder tag cannot drift
    Given a rollback example names the release to roll back to as a placeholder
    When docscheck runs
    Then it raises no finding, because no concrete version is claimed
