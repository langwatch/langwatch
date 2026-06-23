# Code block language support — lazy on-demand + graceful fallback
#
# See dev/docs/adr/027-trace-drawer-code-highlighting.md for the rationale.
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter.ts   (eager base, ensureLanguageLoaded, normalizeShikiLang)
#   langwatch/src/features/traces-v2/components/TraceDrawer/markdownView/ShikiHighlight.tsx (ShikiCodeBlock + render-gating hook)
#
# Related specs (same Shiki highlighting path, all governed by ADR-027):
#   specs/traces-v2/attribute-value-readability.feature — JSON via the shared Shiki renderer
#   specs/traces-v2/io-pretty-markdown.feature          — RenderedMarkdown, whose fenced code lazy-loads here
#
# Motivation: a fenced code block in a language the highlighter hadn't
# loaded threw Shiki's "Language `promql` not found, you may need to load it
# first" instead of just rendering the code, and coverage was limited to a
# hand-maintained list. Shiki bundles ~200 languages as lazy chunks, so we
# load any of them on demand instead.
#
# Decisions (ADR-027):
#   - Eager base for hot paths: json, markdown, bash, typescript, python.
#   - Any other Shiki-bundled language is lazy-loaded on first use
#     (loadLanguage), rendering plain until its grammar resolves.
#   - A language Shiki doesn't bundle (e.g. promql) renders as plain "text"
#     — never an error. Common aliases (ts, js, py, sh, yml, md…) resolve.

Feature: Code block language support

Rule: Unknown languages render without highlighting, never an error
  @unit
  Scenario: A language Shiki does not bundle falls back to plain text
    Given a code block tagged with an unsupported language (e.g. "promql")
    Then it renders as plain text

  @unit
  Scenario: An empty or missing language renders as plain text
    Given a code block with no language tag
    Then it renders as plain "text"

Rule: Any Shiki-bundled language highlights, lazy-loaded on first use
  Scenario: A hot-path language highlights immediately
    Given a code block tagged "json"
    Then it is highlighted on first render with no delay

  Scenario: A long-tail language stays readable then highlights
    Given a code block tagged with a less common bundled language (e.g. "rust")
    Then it first renders as readable plain text
    And it then re-renders highlighted once its grammar is available

  @unit
  Scenario Outline: Common aliases resolve to their canonical grammar
    Given a code block tagged "<alias>"
    Then it resolves to the "<grammar>" grammar

    Examples:
      | alias | grammar    |
      | ts    | typescript |
      | js    | javascript |
      | py    | python     |
      | sh    | bash       |
      | yml   | yaml       |
      | md    | markdown   |

Rule: Highlighting does no work until code is shown
  Scenario: No grammar loads until the drawer highlights something
    Given the trace explorer has loaded but no code has been highlighted yet
    Then no language grammar has been loaded for a less common language
