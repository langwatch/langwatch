Feature: docs.json stays the single source of truth for both documentation sites
  The authored Mintlify configuration drives the new site as well, so a setting changed
  in docs.json changes both sites until Mintlify is retired.

  @unit
  Scenario: Account for every configuration and frontmatter key
    Given docs.json and every page's frontmatter
    When the site's configuration inventory is checked
    Then every key is honoured, pinned to the value the site implements, or recorded as intentionally different
    And a key added to docs.json or to a page's frontmatter without an entry fails the check
    And an entry for a key no longer authored fails the check

  @unit
  Scenario: Describe every page to search engines and social previews
    Given the site has a description and an organization in docs.json
    When a page without its own description is rendered
    Then its meta description is the site description
    And the structured data names the organization as the publisher of the documentation website
    And a page with a known last commit date carries it as its modified date

  @unit
  Scenario: Show when a page was last updated
    Given docs.json turns page timestamps on
    When a page with a known last commit date is rendered
    Then the page shows a "Last updated" date
    But a page without a known date shows none

  @unit
  Scenario: Give agents the site's instructions in every Markdown export
    Given docs.json has Markdown instructions for agents
    When a page's Markdown export is generated
    Then the instructions open the export under an "Agent Instructions" heading, before the page title
    And without instructions the export starts with the page title

  @unit
  Scenario: Show the authored announcement beside the release update
    Given docs.json has a dismissible banner written in Markdown
    When a page is rendered
    Then the announcement is shown with its links and emphasis, above the release update
    And it can be dismissed, keyed by its content so a changed announcement shows again
    And a banner that is not dismissible has no dismiss button

  @unit
  Scenario: Offer the configured page actions
    Given docs.json lists contextual options
    When the page actions menu opens
    Then it offers exactly the configured copy, view, assistant and editor actions in the configured order
    And the editor and MCP actions connect to the LangWatch MCP server

  @unit
  Scenario: Load the tag manager without slowing the page
    Given docs.json names a Google Tag Manager container
    When a production page is rendered
    Then the page names the container but loads no tag script during rendering
    And the tag loads once, after the page is idle or the reader first interacts
    And development builds and local hosts load no tag

  @unit
  Scenario: Load the tag manager only after the reader accepted cookies
    Given docs.json names a Google Tag Manager container
    When the reader has not chosen, has declined, or their browser storage cannot be read
    Then no tag loads
    When the reader accepted cookies on langwatch.ai
    Then the tag loads as on any production page

  @unit
  Scenario: Refuse arbitrary code from the tag manager
    Given docs.json names a Google Tag Manager container
    When the container loads
    Then the page has already refused custom HTML and custom JavaScript tags, whatever the container publishes
    And Google's tags and the gallery templates for other vendors still run

  @unit
  Scenario: Load PostHog with the tag manager, through the site's own proxy
    Given the tag manager loads on a production page
    Then PostHog loads with it, from langwatch.ai's own analytics proxy rather than a PostHog host
    And it records a pageview for every page the reader opens, and never records the session
    And a page that already started PostHog is left as it is

  @unit
  Scenario: Load the Meta pixel and Reo.dev from the page, not from the tag manager
    Given the container runs the Meta pixel and Reo.dev as custom HTML, which the docs refuse
    When the tag manager loads on a production page
    Then the page loads the Meta pixel, with a page view, and Reo.dev itself
    And neither loads before the reader accepted cookies

  @unit
  Scenario: Mark deprecated pages
    Given a page's frontmatter marks it deprecated or gives it a tag
    When the page is rendered
    Then its header shows the tag, "Deprecated" for a deprecated page

  @unit
  Scenario: Explain a missing page with the authored copy
    Given docs.json has a 404 title and a description with links
    When the not found page is rendered
    Then it shows the authored title and the description with working links
