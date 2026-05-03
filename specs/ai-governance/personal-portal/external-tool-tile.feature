Feature: AI Tools Portal — External-tool tile markdown render
  As an end user discovering an internal AI tool admin has linked into
  my /me portal
  I want to expand the tile and read the admin-authored markdown
  description plus open the external link in a new tab
  So that I can find the right entrypoint to a third-party platform
  (e.g. Copilot Studio, Workato, an internal wiki) without leaving the
  LangWatch surface

  Per Phase 7 architecture (rchaves directive 2026-05-03):
    The external-tool tile is markdown + link only — no backend mutation,
    no inline form. Markdown is rendered through the existing sanitizer
    at `~/components/Markdown` so admin input cannot inject script tags.

  Background:
    Given user "jane@acme.com" is on /me with the AI Tools Portal visible
    And the org-scoped catalog has an external-tool entry "Copilot Studio" with:
      | field                | value                                                |
      | descriptionMarkdown  | Microsoft's low-code agent builder...\n\n# Getting started\n- Request access in #copilot-studio-onboarding |
      | linkUrl              | https://copilotstudio.microsoft.com                  |
      | ctaLabel             | Open Copilot Studio                                  |

  Scenario: tile starts collapsed, expands on click
    When user "jane@acme.com" first sees the Copilot Studio tile
    Then only the tile header (display name + class label "Internal tool" + chevron-right) is visible
    And the markdown body is NOT rendered

    When user "jane@acme.com" clicks the Copilot Studio tile
    Then the body reveals the rendered markdown
    And the markdown renders with proper heading hierarchy (H1 inside the body)
    And the "Open Copilot Studio" CTA button renders below the markdown

  Scenario: CTA button opens external URL in a new tab
    Given the Copilot Studio tile is expanded
    When user "jane@acme.com" clicks the "Open Copilot Studio" button
    Then the browser opens "https://copilotstudio.microsoft.com" in a new tab
    And the link includes `target="_blank"` and `rel="noopener noreferrer"`
    And the user is NOT navigated away from /me

  Scenario: tile without ctaLabel uses default "Open <displayName>"
    Given the org-scoped catalog has Workato entry with no `ctaLabel` field
    And the entry has displayName "Workato"
    When user "jane@acme.com" expands the Workato tile
    Then the CTA button renders the text "Open Workato"

  Scenario: markdown sanitization strips dangerous content
    Given an admin (intentionally or not) saved an external-tool entry with `descriptionMarkdown` containing a `<script>alert('xss')</script>` block
    When user "jane@acme.com" expands the tile
    Then the script tag is NOT rendered or executed
    And no console error is thrown
    And the rest of the markdown around the stripped content renders normally

  Scenario: markdown renders multiple lists, headings, bold, and inline code
    Given the org-scoped catalog has an entry with descriptionMarkdown:
      """
      Internal **wiki** for our agent stack.

      # Quick links
      - `langwatch login` → device-flow auth
      - `langwatch claude` → wrapped Claude Code

      ## Support
      - Slack: #ai-tools-help
      """
    When user "jane@acme.com" expands the tile
    Then bold text "wiki" renders bold
    And inline code "langwatch login" renders monospaced
    And both list items under "Quick links" render
    And both heading levels render with appropriate sizing

  Scenario: tile expand does not fire any backend mutation
    Given network requests are observed
    When user "jane@acme.com" expands the Copilot Studio tile
    Then no tRPC mutations are fired
    And no HTTP POST/PUT/PATCH/DELETE requests are sent
    And the click is purely client-side state
