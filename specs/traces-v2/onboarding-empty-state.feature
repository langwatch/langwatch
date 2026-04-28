# Onboarding Empty State — Gherkin Spec
# Based on PRD-001: Onboarding Empty State (revised for PAT + Foundry-backed sample data)
# Covers: empty state display, four setup categories, PAT generation, sample data, first-trace celebration

# ─────────────────────────────────────────────────────────────────────────────
# EMPTY STATE DISPLAY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Onboarding empty state
  When a project has no traces, the Observe page replaces the trace table
  with a setup flow that helps the user send their first trace, while
  keeping the page chrome (search bar, filters, toolbar) visible in an
  inert state so the layout the user is moving toward is on screen.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has zero traces

  Scenario: Empty state renders when project has no traces
    When the Observe page loads
    Then the trace table is replaced by the onboarding setup flow
    And the heading reads "Send your first trace"

  Scenario: Page chrome stays visible but inert
    When the Observe page loads with zero traces
    Then the search bar is rendered in a dimmed, non-interactive state
    And the filter sidebar is rendered in a dimmed, non-interactive state
    And the toolbar is rendered in a dimmed, non-interactive state
    And focus, hover, and pointer events do not reach the dimmed chrome

  Scenario: Empty state shows the four setup categories
    When the Observe page loads
    Then a tab strip is visible with: "Via the Platform", "Via Coding Agent", "Via MCP", "Manually"
    And "Via the Platform" is selected by default
    And the active tab's description text is shown beneath the tab strip


# ─────────────────────────────────────────────────────────────────────────────
# SETUP PATH: VIA THE PLATFORM
# ─────────────────────────────────────────────────────────────────────────────

Feature: Via the Platform setup path
  Configure everything directly from the LangWatch dashboard.

  Background:
    Given the empty state is visible
    And the "Via the Platform" tab is selected

  Scenario: Platform body lists product capabilities
    Then a grid of capability cards is shown
    Including "Traces & Analytics", "Evaluations", "Prompts", "Scenarios", "Datasets", "Model Providers"
    And each card links to the matching dashboard area for the active project


# ─────────────────────────────────────────────────────────────────────────────
# SETUP PATH: VIA CODING AGENT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Via Coding Agent setup path
  Set up using prompts, skills, or MCP from a coding agent — Claude Code,
  Cursor, Windsurf, Copilot, OpenAI Codex.

  Background:
    Given the empty state is visible
    And the "Via Coding Agent" tab is selected

  Scenario: Coding Agent body offers prompt, skill, and MCP modes
    Then three sub-tabs are visible: "Prompt", "Skill", "MCP"
    And each mode lists copyable instructions for the supported coding agents


# ─────────────────────────────────────────────────────────────────────────────
# SETUP PATH: VIA MCP
# ─────────────────────────────────────────────────────────────────────────────

Feature: Via MCP setup path
  Connect any MCP client — Claude Desktop, ChatGPT, plus other compatible clients.

  Background:
    Given the empty state is visible
    And the "Via MCP" tab is selected

  Scenario: MCP body shows app-specific setup
    Then "Claude Desktop" and "ChatGPT" sub-tabs are visible
    And each app's panel shows numbered setup steps and a copyable MCP config snippet
    And the snippet pre-fills the project's masked API key


# ─────────────────────────────────────────────────────────────────────────────
# SETUP PATH: MANUALLY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Manually setup path
  Direct SDK integration with platform/framework code snippets.

  Background:
    Given the empty state is visible
    And the "Manually" tab is selected

  Scenario: Platform and framework selectors are visible
    Then a platform selector is shown with TypeScript, Python, Go, Java, OpenTelemetry, and No-and-Low-Code
    And the framework selector lists every framework registered for the active platform
    And the right-hand pane shows the install snippet, code snippet, and docs links

  Scenario: Switching platform updates the framework list and code preview
    Given the user selected "Manually"
    When the user selects platform "Python"
    Then the framework selector shows the Python framework set
    And the code preview pane shows a Python snippet for the first framework in that set


# ─────────────────────────────────────────────────────────────────────────────
# PERSONAL ACCESS TOKEN GENERATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Generate access token for setup
  The Manually tab exposes a "Generate access token" card so the user can
  mint a PAT scoped to the current project without leaving the page.

  Background:
    Given the empty state is visible
    And the "Manually" tab is selected

  Scenario: Initial state shows the generate-token card
    Then a card titled "Generate an access token" is visible
    And the card explains the user will receive a Personal Access Token plus the project ID
    And a "Generate access token" button is enabled

  Scenario: Generating creates a project-scoped PAT
    When the user clicks "Generate access token"
    Then a PAT is created via personalAccessToken.create
    And the PAT name is "Initial API key"
    And the PAT bindings mirror the caller's role bindings in the organization
    # TODO: Mirror the project owner's bindings instead of the caller's. The
    # current behaviour matches the Settings UI, but a project-owner-specific
    # query needs adding before this onboarding can serve invited members.

  Scenario: Generated token is shown once with env vars
    Given the user successfully generated a token
    Then the card shows three env-var lines: LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID, LANGWATCH_ENDPOINT
    And LANGWATCH_API_KEY is masked behind a reveal toggle
    And the .env block has a single Copy button that copies all three lines
    And a warning reads "Copy this token now. You won't be able to see it again."

  Scenario: Token failure shows a toast and leaves the card untouched
    Given the personalAccessToken.create mutation fails
    When the user clicks "Generate access token"
    Then a toast surfaces the error message
    And the generate button returns to its enabled state


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE DATA
# ─────────────────────────────────────────────────────────────────────────────

Feature: Sample data exploration
  Users can explore the UI with realistic data before integrating their
  own app. Sample traces are minted client-side via Foundry's trace
  generator and POSTed to the standard OTLP endpoint, so every downstream
  feature (drawer, filters, deep links) just works on them.

  Background:
    Given the empty state is visible

  Scenario: Sample data link is visible below the setup body
    Then an "Explore with sample data" button is visible below the four-tab setup body
    And it sits under a divider with "or"

  Scenario: Loading sample data generates real traces tagged as samples
    When the user clicks "Explore with sample data"
    Then approximately a dozen synthetic traces are generated client-side
    And every span carries the attribute "langwatch.sample" set to true
    And the traces are POSTed to the OTLP endpoint with the project's API key
    And a success toast tells the user to wait for the collector to land them

  Scenario: Sample data banner appears after a successful load
    Given the user just loaded sample data
    Then a "Viewing sample data" banner is shown above the chrome
    And the banner has an "Exit demo" affordance

  Scenario: Exit demo dismisses the banner
    Given the sample-data banner is showing
    When the user clicks "Exit demo"
    Then the banner disappears
    # TODO: Persistently delete sample-tagged traces. Today the banner only
    # hides — sample traces remain in ClickHouse and are visible in the
    # table until they age out. We need a tRPC mutation that deletes traces
    # WHERE langwatch.sample = true for a given projectId.

  Scenario: Sample data button is disabled without an API key
    Given the active project has no resolvable apiKey
    Then the "Explore with sample data" button is disabled


# ─────────────────────────────────────────────────────────────────────────────
# FIRST REAL TRACE CELEBRATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: First trace celebration
  When real traces arrive for the first time, the user sees a celebration.

  Background:
    Given the project previously had zero traces

  Scenario: Confetti and banner on first real traces
    When the first real traces arrive for the project
    Then a confetti burst animation plays for approximately 2 seconds
    And a banner reads "Your first traces are arriving!" with a tada emoji

  Scenario: Celebration banner auto-dismisses
    Given the first-trace celebration banner is showing
    When 10 seconds elapse
    Then the banner auto-dismisses

  Scenario: Celebration banner can be dismissed manually
    Given the first-trace celebration banner is showing
    When the user clicks dismiss on the banner
    Then the banner disappears immediately

  Scenario: Celebration only triggers once per project
    Given the first-trace celebration has already been shown for this project
    When the user navigates away and returns to the Observe page
    Then no celebration triggers again
