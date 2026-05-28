Feature: Token Created modal command snippets
  As a user who has just minted an API key
  I want syntax-highlighted, PostHog-style command snippets in the Token Created modal
  So that the code I am about to paste into a terminal or config file is easy to read, copy, and trust

  Background:
    Given I am signed in as a user in an organization with at least one project
    And I have just created a new API key on /settings/api-keys
    And the Token Created dialog is open with the newly minted token

  # ============================================================================
  # Highlighting engine — Shiki, github-light, singleton highlighter
  # ============================================================================
  # No new syntax-highlighting library is introduced. Shiki v3.x is already a
  # dependency; the singleton highlighter lives in shikiAdapter.ts.

  @integration
  Scenario: All command snippets are syntax-highlighted via the existing Shiki singleton
    When the Token Created dialog renders any of its command/config blocks
    Then the highlight is produced by the existing shikiAdapter singleton highlighter
    And the theme is "github-light" (settings UI is light-theme only)
    And no second syntax-highlighting library is added to package.json

  @integration
  Scenario: Required Shiki languages are registered up-front in shikiAdapter
    Given today's shikiAdapter registers: markdown, json, bash, typescript, python, xml, html, yaml
    When this feature is implemented
    Then shikiAdapter additionally registers `ini` (for the .env tab) and keeps `bash` for terminal commands and `json` for the config block
    And the Bearer / Basic Auth tabs use `shellscript` (which Shiki ships as a bash alias) — no `http` or `curl` grammar is required
    And language registration happens inside shikiAdapter, not inline at the call site
    And no language is loaded with a hopeful "(or fallback)" — every block declares one concrete language

  # ============================================================================
  # "Use in Code" section — three tabs (.env / Bearer / Basic Auth)
  # ============================================================================
  # Today these render via the plain CodeBlock.tsx (monospace, no highlighting).
  # After this change they share the new PostHog-style command-box look.

  @integration
  Scenario: .env tab renders as a highlighted ini command box
    When I select the ".env" tab inside "Use in Code"
    Then the snippet renders inside the new highlighted command-box style
    And the language passed to shikiAdapter is `ini`
    And LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID, and LANGWATCH_ENDPOINT keys are visually distinct from their string values

  @integration
  Scenario: Bearer tab renders as a highlighted shell command box
    When I select the "Bearer" tab inside "Use in Code"
    Then the snippet renders inside the new highlighted command-box style
    And the snippet shows an `Authorization: Bearer <token>` line plus an `X-Project-Id` line
    And the language passed to shikiAdapter is `shellscript` (bash-grammar alias already registered)

  @integration
  Scenario: Basic Auth tab renders as a highlighted shell command box
    When I select the "Basic Auth" tab inside "Use in Code"
    Then the snippet renders inside the new highlighted command-box style
    And the snippet shows an `Authorization: Basic base64(projectId:token)` line
    And the language passed to shikiAdapter is `shellscript` (bash-grammar alias already registered)

  # ============================================================================
  # "Use with Code Assistants" section — terminal command + JSON config
  # ============================================================================

  @integration
  Scenario: Claude Code tab shows a PostHog-style terminal command snippet
    When I select the "Claude Code" tab inside "Use with Code Assistants"
    Then the "Run in your terminal" snippet renders inside the new command-box style
    And the language passed to shikiAdapter is `bash`
    And the snippet displays a leading terminal prompt glyph ">_" on the left of the command (rendered as a CSS pseudo-element or sibling overlay — NOT part of the source string)
    And the executable name "claude" is visually distinct from its flags and arguments via bash tokenization
    And the api-key argument is visually distinct from the rest of the line via Shiki's bash tokenization (the `--api-key` flag and its value token render as visually distinct tokens via the github-light theme)

  @integration
  Scenario: Codex tab shows a PostHog-style terminal command snippet
    When I select the "Codex" tab inside "Use with Code Assistants"
    Then the "Run in your terminal" snippet renders inside the new command-box style
    And the language passed to shikiAdapter is `bash`
    And the snippet displays a leading terminal prompt glyph ">_" on the left of the command (rendered as a CSS pseudo-element or sibling overlay — NOT part of the source string)
    And the executable name "codex" is visually distinct from its `--env` / `--` / `npx` flags and arguments via bash tokenization

  @integration
  Scenario: Terminal prompt glyph is not included in the copied value
    Given any terminal command snippet rendered with the ">_" prompt glyph
    When I click the copy button on that snippet
    Then the clipboard receives ONLY the executable command (e.g. `claude mcp add langwatch --env … -- npx -y @langwatch/mcp-server --api-key …`)
    And the clipboard does NOT contain ">_" or any leading prompt characters
    And the prompt glyph is asserted to be rendered via a CSS pseudo-element / sibling DOM node, not the source string passed to shikiAdapter or to `copyValue`

  @integration
  Scenario: JSON config block keeps the existing JsonHighlight wiring
    Given the Token Created dialog today already renders the JSON config block via the existing JsonHighlight component with `highlightLines={findLangwatchEnvLines(...)}`
    When the dialog renders the "Or paste into your config file" block after this refactor
    Then it still uses the SAME JsonHighlight component (no swap, no replacement)
    And the lines containing LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID, and LANGWATCH_ENDPOINT are still passed to `highlightLines` and rendered with the sensitive-amber background
    And no parallel JSON highlighter is introduced

  # ============================================================================
  # Preserved behaviour — nothing about copy / reveal / warning regresses
  # ============================================================================

  @integration
  Scenario: Copy button is present on every command box
    When any command box in the Token Created dialog renders
    Then a copy button is visible on the box
    And clicking it copies the unmasked value (real token, real project id, real endpoint) to the clipboard

  @integration
  Scenario: Copy button flashes a success state on click
    # Timing assertions use fake timers in the integration test (e.g. vi.useFakeTimers + vi.advanceTimersByTime).
    # Do NOT write sleep() assertions.
    When I click the copy button on a command box
    Then the button enters a success state (check icon and success colour)
    And after advancing timers by 1 second the button returns to its default copy state

  @integration
  Scenario: Reveal toggle still works for masked secret values
    Given a command box currently shows a masked value (e.g. "pat-lw-…")
    When I click the reveal (eye) toggle
    Then the masked value is replaced by the real value inside the highlighted snippet
    When I click the hide (eye-off) toggle
    Then the masked value is shown again

  @integration
  Scenario: Reveal toggle does not re-tokenize on every click
    # Verify call count by spying on shikiAdapter.codeToHtml (vi.spyOn) before rendering.
    Given the Token Created dialog has pre-computed Shiki token streams for both the masked and the unmasked form of each command box
    When I toggle the reveal eye N times rapidly
    Then shikiAdapter.codeToHtml is called at most twice per command box per dialog open (once for masked, once for unmasked — asserted via spy call count)
    And the toggle swaps between the two pre-computed token streams, not re-tokenizes from scratch on each click

  @integration
  Scenario: Copy and reveal buttons coexist in the existing header bar without overlap
    Given today's CodeBlock keeps the copy button and the reveal (eye) toggle in a header bar above the snippet
    When the box is rewritten in the PostHog-style command-box look
    Then both controls remain in a single header / control row above the highlighted code (NOT floated into the same top-right corner of the code area)
    And neither button overlaps the other or the leading ">_" prompt glyph

  @integration
  Scenario: Amber warning between .env block and Code Assistants section stays
    When the Token Created dialog renders
    Then between the "Use in Code" block and the "Use with Code Assistants" section there is an amber/warning alert reading "Copy this token now. You won't be able to see it again."
    And the warning is prominently visible (not collapsed, not dismissible by default)

  # ============================================================================
  # Overflow / layout
  # ============================================================================

  @integration
  Scenario: Long lines scroll horizontally inside the command box
    Given a command snippet that is wider than the dialog content area (e.g. a long endpoint URL)
    When the snippet renders
    Then the command box scrolls horizontally
    And the snippet does NOT wrap onto multiple visual lines
    And the snippet is NOT truncated with an ellipsis

  # ============================================================================
  # Surface unification — one styled command box, not two
  # ============================================================================
  # TokenCreatedDialog today renders code via TWO distinct surfaces:
  #   - CodeBlock.tsx (.env / Bearer / Basic Auth)
  #   - QuickCommand (Claude Code / Codex one-line commands)
  # After this work the visible surface is one styled box; copy/reveal controls
  # stay where users expect them.

  @unit
  Scenario: A single shared command-box component replaces CodeBlock and QuickCommand inside TokenCreatedDialog
    # Verifiable by grepping TokenCreatedDialog imports: one command-box component imported for all snippet blocks;
    # no direct import of CodeBlock or QuickCommand for snippet rendering; accentCredentialSegments imported from
    # its original location (not re-implemented).
    When this feature is implemented
    Then TokenCreatedDialog imports ONE shared command-box component and uses it for every snippet block (.env / Bearer / Basic Auth / Claude Code / Codex)
    And TokenCreatedDialog does not directly import CodeBlock or QuickCommand for snippet rendering
    And the JSON config block continues to be rendered by JsonHighlight (which is itself Shiki-backed)
    And credential token visual distinction is achieved by Shiki's bash tokenization (the `--api-key` flag and its value render as distinct tokens via the github-light theme) — no regex decoration pass

  # ============================================================================
  # Bundle cost — lazy-load Shiki so the settings page stays light
  # ============================================================================

  @unit
  Scenario: TokenCreatedDialog lazy-loads the Shiki-backed command box on dialog open
    # First two Then-clauses are static import checks (grep-verifiable).
    # Third clause (chunk loads on dialog open) is a runtime bundle behaviour; verify in a
    # browser devtools Network audit or an @integration test that spies on dynamic import resolution.
    Given /settings/api-keys today does not statically import shikiAdapter (the Shiki bundle is ~hundreds of KB)
    When this feature is implemented
    Then the new shared command-box component is imported into TokenCreatedDialog via `dynamic(() => import('...'), { ssr: false })` (or equivalent React.lazy boundary)
    And /settings/api-keys/index.tsx does NOT contain a static top-level import of shikiAdapter

  # ============================================================================
  # Accessibility
  # ============================================================================

  @integration
  Scenario: Copy success is announced to assistive tech
    When I click the copy button on any command box
    Then a polite live-region announcement (via aria-live=polite or the existing toaster) communicates "Copied" to assistive tech
    And the success-flash visual cue runs in parallel with the announcement (the cue is not the only feedback channel)

  # ============================================================================
  # Out of scope guardrail — keep the change surface honest
  # ============================================================================
  # Out of scope: CreateApiKeyDrawer.tsx — this work touches only TokenCreatedDialog and its
  # highlighted snippet surfaces. CreateApiKeyDrawer must not be modified.

  @unit
  Scenario: No new highlighting library is added
    # Verifiable by grepping langwatch/package.json: no new syntax-highlighting dependency added.
    # Per-render instantiation guard is covered by the Shiki singleton integration scenario above.
    When this feature is implemented
    Then no syntax-highlighting library other than Shiki appears in langwatch/package.json
