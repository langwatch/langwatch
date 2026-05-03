Feature: AI Tools Portal — Grid layout on /me
  As an end user signing in to LangWatch via generic `langwatch login`
  I want my /me dashboard to surface the AI tools I'm allowed to use
  as a card grid, grouped by class (coding assistant / model provider /
  internal tool)
  So that I can pick the next tool to set up without hunting through
  documentation or asking my admin

  Per Phase 7 architecture (rchaves directive 2026-05-03):
    /me is the AI Tools Home. Portal grid hero on top, existing usage
    dashboard below. Single landing surface; no ferry between two URLs.
    The portal is the customizable company portal — admins curate the
    catalog at org or team scope, end-users see only what they're allowed.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" is a MEMBER of organization "acme"
    And user "jane@acme.com" is on team "engineering"
    And the `release_ui_ai_governance_enabled` feature flag is on
    And the org has at least one default routing policy published

  Scenario: portal renders three sections in fixed order when populated
    Given the org-scoped catalog has these enabled entries:
      | type              | displayName    | order |
      | coding_assistant  | Claude Code    |     1 |
      | coding_assistant  | Codex          |     2 |
      | model_provider    | Anthropic      |     1 |
      | model_provider    | OpenAI         |     2 |
      | external_tool     | Copilot Studio |     1 |
    When user "jane@acme.com" loads "/me"
    Then the portal renders three section headings in this order:
      | Coding assistants                                  |
      | Model providers (issue your own virtual key)       |
      | Internal tools                                     |
    And each section renders the matching tiles in their `order`
    And the existing "My Usage" dashboard renders below the portal

  Scenario: empty section is hidden, not shown empty
    Given the org-scoped catalog has only model-provider entries
    When user "jane@acme.com" loads "/me"
    Then the "Coding assistants" section heading does NOT render
    And the "Internal tools" section heading does NOT render
    And the "Model providers" section renders normally

  Scenario: brand-new org with no catalog shows CLI-fallback callout
    Given the org-scoped catalog is empty
    And no team-scoped entries are published for any of jane's teams
    When user "jane@acme.com" loads "/me"
    Then a single empty-state callout renders titled "Your AI tools portal"
    And the callout explains the user can install the LangWatch CLI and run `langwatch login` to get started
    And no tile sections render
    And the existing "My Usage" dashboard still renders below

  Scenario: team-scoped entries override org-scoped entries by slug
    Given the org-scoped catalog publishes "Claude Code" with `setupCommand=langwatch claude`
    And the team-scoped catalog for team "engineering" publishes "Claude Code" with `setupCommand=langwatch claude --team-engineering`
    When user "jane@acme.com" (member of team "engineering") loads "/me"
    Then exactly ONE Claude Code tile renders
    And clicking that tile reveals `setupCommand=langwatch claude --team-engineering`

  Scenario: disabled entries are excluded from the user-facing list
    Given the org-scoped catalog has Claude Code entry with `enabled=false`
    And the org-scoped catalog has Codex entry with `enabled=true`
    When user "jane@acme.com" loads "/me"
    Then the Claude Code tile does NOT render
    And the Codex tile DOES render

  Scenario: feature flag off hides the whole portal
    Given the `release_ui_ai_governance_enabled` feature flag is OFF
    When user "jane@acme.com" loads "/me"
    Then the portal does NOT render
    And the page renders the not-found scene
    And no `api.aiTools.list` query is fired
