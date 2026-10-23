Feature: Agents discover the documentation and its skills
  The site publishes the same agent discovery files the current documentation serves.

  @unit
  Scenario: The agent-skills index lists each skill once with a digest of its published file
    Given the skills named in the skills pages manifest
    When the discovery files are generated
    Then the index lists each skill once in first-seen order, named by its last path segment
    And each entry has the absolute address of its SKILL.md and the SHA-256 digest of its bytes
    And each SKILL.md is published unchanged at that address

  @unit
  Scenario: A skill without a description in its frontmatter falls back to its manifest title
    Given a skill whose SKILL.md has no description
    When the skills are read
    Then its description is the manifest title

  @unit
  Scenario: The agent card names LangWatch and lists its skills
    Given the skills named in the skills pages manifest
    When the discovery files are generated
    Then the agent card carries the site summary, the docs address and one entry per skill

  @unit
  Scenario: Robots.txt declares the content signals
    When the discovery files are generated
    Then robots.txt has the content signal line right after the user agent line

  @unit
  Scenario: Every page head links the agent discovery files
    When a page head is generated
    Then it links llms.txt, llms-full.txt, the agent card and the skills index by absolute address

  @unit
  Scenario: An agent that asks for Markdown gets the page's Markdown
    Given a published page with its Markdown twin
    When a request for the page's address prefers text/markdown at least as much as text/html
    Then the preview answers with the Markdown twin as text/markdown
    And every page response names its twin in a Link header and varies by Accept
    But a browser asking for HTML still gets the page

  @unit
  Scenario: Serve files with the caching a production host gives them
    When the preview serves a build
    Then content-hashed assets may be cached for a year without asking again
    And fonts and media for a day, revalidated in the background for a week
    And pages, the search index and agent files are revalidated every time
