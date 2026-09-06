Feature: Token Created modal command snippets
  As a user who has just minted an API key
  I want the Token Created modal's snippets rendered through the same shared,
  labelled code-preview surface the traces empty state and onboarding use
  So that the code I am about to paste into a terminal or config file is easy to read, copy, and trust — and looks like the rest of the product

  Background:
    Given I am signed in as a user in an organization with at least one project
    And I have just created a new API key on /settings/api-keys
    And the Token Created dialog is open with the newly minted token

  # ============================================================================
  # Highlighting engine — the shared CodePreview (Chakra CodeBlock + Shiki)
  # ============================================================================
  # No new syntax-highlighting library is introduced. The dialog renders its
  # snippets through the same CodePreview component the onboarding and traces
  # empty-state surfaces already use; CodePreview loads Shiki lazily inside its
  # adapter, so the engine never enters the settings page bundle statically.

  @integration
  Scenario: All command snippets are syntax-highlighted
    When the Token Created dialog renders any of its command/config blocks
    Then each snippet renders with token-level colour (not flat monospace text)
    And the rendered theme follows the active colour mode (github-light in light mode, github-dark in dark mode)

  @unit
  Scenario: Highlight engine wiring — CodePreview registers the languages the dialog needs
    # Structural invariant rather than user-observable behaviour, hence `@unit`.
    Given CodePreview's shiki adapter registers: typescript, python, go, yaml, bash, json
    When this feature is implemented
    Then the adapter additionally registers `ini` (for the .env tab) and `shellscript` (for the Bearer / Basic Auth tabs)
    And language registration happens inside CodePreview's adapter, not inline at the call site
    And no language is loaded with a hopeful "(or fallback)" — every block declares one concrete language
    And no second syntax-highlighting library is added to package.json

  # ============================================================================
  # "Use in Code" section — three tabs (.env / Bearer / Basic Auth)
  # ============================================================================

  @integration
  Scenario: .env tab renders in the shared labelled code preview
    When I select the ".env" tab inside "Use in Code"
    Then the snippet renders inside the shared CodePreview box
    And the box header carries the label ".env"
    And LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID, and LANGWATCH_ENDPOINT keys are visually distinct from their string values

  @integration
  Scenario: Bearer tab renders in the shared labelled code preview
    When I select the "Bearer" tab inside "Use in Code"
    Then the snippet renders inside the shared CodePreview box with a header label naming the snippet
    And the snippet shows an `Authorization: Bearer <token>` line plus an `X-Project-Id` line

  @integration
  Scenario: Basic Auth tab renders in the shared labelled code preview
    When I select the "Basic Auth" tab inside "Use in Code"
    Then the snippet renders inside the shared CodePreview box with a header label naming the snippet
    And the snippet shows an `Authorization: Basic <base64 of projectId:token>` line

  # ============================================================================
  # Masking — the encoded credential is the secret, not just the raw token
  # ============================================================================
  # CodePreview masks by substring-replacing its `sensitiveValue` inside the
  # rendered code. A raw token is NOT a substring of its own base64 encoding,
  # so the Basic Auth block must declare the encoded blob as the sensitive
  # value — otherwise masking silently fails open.

  @integration
  Scenario: Basic Auth masking hides the encoded credential
    Given the Basic Auth tab is showing its masked form
    Then the base64-encoded credential is not readable in the snippet
    And toggling reveal shows the full encoded credential

  @integration
  Scenario: Basic Auth tab without a resolvable project still explains itself
    # The encoded header needs a project id, so without one there is no
    # snippet to show — but a silently blank tab reads as broken.
    Given no project is resolvable for the freshly minted key
    When I select the "Basic Auth" tab inside "Use in Code"
    Then the helper text explaining the base64(projectId:token) format is still shown
    And instead of a snippet box the tab asks the user to select a project

  # ============================================================================
  # "Use with Code Assistants" section — terminal command + JSON config
  # ============================================================================

  @integration
  Scenario: Claude Code tab shows a labelled terminal command snippet
    When I select the "Claude Code" tab inside "Use with Code Assistants"
    Then the "Run in your terminal" snippet renders inside the shared CodePreview box with a header label naming the snippet
    And the executable name "claude" is visually distinct from its flags and arguments

  @integration
  Scenario: Codex tab shows a labelled terminal command snippet
    When I select the "Codex" tab inside "Use with Code Assistants"
    Then the "Run in your terminal" snippet renders inside the shared CodePreview box with a header label naming the snippet
    And the executable name "codex" is visually distinct from its `--env` / `--` / `npx` flags and arguments

  # A customer reported that only Claude Code and Codex appeared here, while the
  # product documents the LangWatch MCP server for more assistants than that.
  # The tabs are now driven by one list of assistants rather than hand-written
  # pairs, so a supported assistant cannot be silently missing from the dialog.

  @integration
  Scenario: Every supported coding assistant has a tab
    When the "Use with Code Assistants" section renders
    Then there is one tab per coding assistant the product supports for the MCP server
    And selecting a tab shows only that assistant's setup instructions

  @integration
  Scenario: An assistant with an install command shows a terminal snippet
    When I select a tab for an assistant that installs the MCP server from the terminal
    Then the "Run in your terminal" snippet renders inside the shared CodePreview box
    And the snippet is that assistant's own command, carrying the freshly minted token

  @integration
  Scenario: An assistant without an install command points at its config file
    When I select a tab for an assistant that has no terminal installer
    Then no terminal command is offered for it
    And the dialog names the config file that assistant reads
    And the JSON config block below remains the thing to paste into it

  @unit
  Scenario: One list of coding assistants drives both the tabs and the config paths
    # The dialog previously held two disagreeing lists: two tabs, and five
    # editor config paths naming a different set of tools.
    When this feature is implemented
    Then the tab labels and the config-file paths are derived from a single list
    And adding an assistant to that list is the only edit needed to surface it

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
  Scenario: Copy delivers the real value even while the snippet is masked
    # The default CodeBlock copy trigger copies whatever string is rendered,
    # which is the masked form when the snippet is hidden. The dialog's boxes
    # must feed the clipboard the real value regardless of reveal state — a
    # user who copies "sk-l***...***X6RA" into their .env gets a broken SDK
    # with no error pointing here.
    Given a command box currently shows a masked value
    When I click the copy button without revealing the snippet first
    Then the clipboard receives the real, unmasked value

  @integration
  Scenario: Copy button flashes a success state on click
    # Timing assertions use fake timers in the integration test (e.g. vi.useFakeTimers + vi.advanceTimersByTime).
    # Do NOT write sleep() assertions.
    When I click the copy button on a command box
    Then the button enters a success state (check icon)
    And after advancing timers by 2 seconds the button returns to its default copy state
    # 2 seconds is the shared InlineCopyButton's flash — the dialog reuses it
    # rather than carrying its own timing.

  @integration
  Scenario: Reveal toggle still works for masked secret values
    Given a command box currently shows a masked value (e.g. "pat-lw-…")
    When I click the reveal (eye) toggle
    Then the masked value is replaced by the real value inside the highlighted snippet
    When I click the hide (eye-off) toggle
    Then the masked value is shown again

  @integration
  Scenario: Copy and reveal buttons coexist in the box header without overlap
    When a command box with a maskable value renders
    Then the box header carries the snippet label on the left and the reveal (eye) toggle plus copy button on the right, in a single header row above the highlighted code
    And neither button overlaps the other or the header label

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
  # Surface unification — the dialog uses the product's shared snippet surface
  # ============================================================================
  # TokenCreatedDialog previously rendered code via a dialog-local component
  # (ShikiCommandBox) that diverged visually from every other snippet surface:
  # no filename label in the header, its own theming. The traces empty state
  # and onboarding screens render through CodePreview. One product, one
  # snippet surface.

  @unit
  Scenario: The dialog renders snippets through the same component as the traces empty state
    # Verifiable by grepping TokenCreatedDialog imports: CodePreview imported
    # for all snippet blocks; ShikiCommandBox no longer exists in the repo.
    When this feature is implemented
    Then TokenCreatedDialog imports the shared CodePreview and uses it for every snippet block (.env / Bearer / Basic Auth / terminal commands)
    And the dialog does not import any dialog-local command-box component
    And the ShikiCommandBox component is deleted from the codebase
    And the JSON config block continues to be rendered by JsonHighlight (which is itself Shiki-backed)

  # ============================================================================
  # Bundle cost — Shiki stays out of the settings page's static bundle
  # ============================================================================

  @unit
  Scenario: The Shiki engine loads only when a code block renders
    # Static import checks (grep-verifiable): CodePreview's adapter performs
    # `await import("shiki")` inside its load() callback, so importing
    # CodePreview does not statically pull the engine.
    Given /settings/api-keys today does not statically import the Shiki engine (the bundle is ~hundreds of KB)
    When this feature is implemented
    Then /settings/api-keys does not gain a static top-level import of the shiki package or of shikiAdapter
    And the engine is loaded by CodePreview's adapter only when a code block mounts

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
  # Out of scope: CreateApiKeyDrawer.tsx, the amber banner's visual styling,
  # and the onboarding/traces surfaces themselves (they are the reference).

  @unit
  Scenario: No new highlighting library is added
    # Verifiable by grepping platform/app/package.json: no new syntax-highlighting dependency added.
    When this feature is implemented
    Then no syntax-highlighting library other than Shiki appears in platform/app/package.json
