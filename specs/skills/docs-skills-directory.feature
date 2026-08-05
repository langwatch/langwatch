@skills @docs
Feature: Public skills directory docs pages
  As a visitor of langwatch.ai/docs/skills pages
  I want to browse, copy, and download LangWatch skills
  So that I can set up LangWatch through my AI coding assistant

  # The directory pages are docs/skills/directory.mdx and
  # docs/skills/pms-and-domain-experts.mdx, rendered by Mintlify.

  Scenario: Downloading a SKILL.md from a skill accordion
    Given a visitor opens a skill entry on the skills directory page
    When they click "Download SKILL.md"
    Then the browser saves the SKILL.md file for that skill
    And the file content is the skill published in the langwatch/skills repository

  Scenario: Every listed skill exists in the published skills repository
    Given the directory pages list skills by their published path
    Then every listed skill path resolves to a skill produced by the publish sync
    And recipes resolve under their nested recipes path

  Scenario: Every copyable prompt on the pages exists in the generated prompts data
    Given the directory pages offer "Copy Full Prompt" actions
    Then every prompt referenced by the pages exists in the generated prompts data

  Scenario: Directory content is readable without executing JavaScript
    Given a search engine crawler fetches a skills directory page
    When the crawler does not execute JavaScript
    Then the response HTML already contains the skill titles and install commands
    And copy and download actions keep working for real visitors after the page loads
