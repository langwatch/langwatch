Feature: AI Tools Portal — Coding-assistant tile click-to-expand
  As an end user choosing a coding CLI from my /me portal
  I want clicking a coding-assistant tile to reveal the exact command
  to run, with copy support and a walkthrough of what happens next
  So that I can paste-and-run instead of hunting through SDK docs

  Per Phase 7 architecture (rchaves directive 2026-05-03):
    The coding-assistant tile click reveals the existing `langwatch <tool>`
    flow — no new backend. The tile's `config.setupCommand` and optional
    `helperText`+`setupDocsUrl` are the only stored fields.

  Background:
    Given user "jane@acme.com" is on /me with the AI Tools Portal visible
    And the org-scoped catalog has a coding-assistant entry "Claude Code" with:
      | field         | value                                                   |
      | setupCommand  | langwatch claude                                        |
      | helperText    | Opens a browser to your LangWatch login, provisions ... |

  Scenario: tile starts collapsed, expand on click
    When user "jane@acme.com" first sees the Claude Code tile
    Then only the tile header (display name + class label + chevron-right) is visible
    And the setup command is NOT visible

    When user "jane@acme.com" clicks the Claude Code tile
    Then the chevron flips to chevron-down
    And the body reveals "Run this in your terminal:" prose
    And a code block renders the text "$ langwatch claude"
    And a copy-to-clipboard icon button is present next to the code block
    And the helper text renders below the code block

  Scenario: copy button copies the bare command (no leading $)
    Given the Claude Code tile is expanded
    When user "jane@acme.com" clicks the copy button
    Then the system clipboard receives the string "langwatch claude"
    And the copy icon swaps to a check icon for ~1.5 seconds
    And then reverts to the copy icon

  Scenario: clicking the tile header again collapses it
    Given the Claude Code tile is expanded
    When user "jane@acme.com" clicks the tile header again
    Then the body collapses
    And the chevron reverts to chevron-right
    And the tile remains in the grid (not removed)

  Scenario: tile with optional setupDocsUrl renders an external link
    Given the org-scoped catalog has Claude Code entry with `setupDocsUrl=https://docs.example/claude-setup`
    When user "jane@acme.com" expands the Claude Code tile
    Then a "Setup guide ↗" button renders below the helper text
    And the button's `href` is "https://docs.example/claude-setup"
    And the button opens in a new tab (target=_blank rel=noopener)

  Scenario: tile without helperText omits the helper section
    Given the org-scoped catalog has Codex entry with no `helperText` field
    When user "jane@acme.com" expands the Codex tile
    Then the code block renders with the setup command
    And no helper-text paragraph renders below it

  Scenario: tile expand does not fire any backend mutation
    Given network requests are observed
    When user "jane@acme.com" expands the Claude Code tile
    Then no tRPC mutations are fired
    And no HTTP POST/PUT/PATCH/DELETE requests are sent
    And the click is purely client-side state
