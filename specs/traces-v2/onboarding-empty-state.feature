# Onboarding Empty State — Gherkin Spec
# Covers: empty state display, journey storytelling, PAT minting inside the Integrate drawer
#
# AUDIT NOTE (2026-05-01): The previously-specced "four flat tabs of static
# setup content" empty state was replaced by a stage-driven storytelling
# journey (`onboardingJourneyConfig.ts`). The four-tab integration UI now
# lives inside a side drawer (`IntegrateDrawer`) opened via the "Integrate
# my code" CTA, and "Explore with sample data" is replaced by a
# table-overlaying preview of fixture traces (`useSamplePreview`) tied to
# the journey itself — no client-side OTLP POST happens. Scenarios that
# described the old layout have been deleted; the ones below match what
# `TracesEmptyOnboarding`, `IntegrateDrawer`, `PatIntegrationInfoCard`,
# `SampleDataBanner`, and `CelebrationBanner` actually do.

# ─────────────────────────────────────────────────────────────────────────────
# EMPTY STATE DISPLAY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Onboarding empty state

Rule: Onboarding empty state
  When a project has never received a real trace, the Observe page
  replaces the trace table with a stage-driven journey that walks the
  user through what the explorer can do, while keeping the chrome
  (search bar, filter sidebar, toolbar) on-screen in a dimmed inert
  state so the layout the user is moving toward stays visible.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project's `firstMessage` flag is false

  Scenario: Empty state renders when project has never received a trace
    When the Observe page loads
    Then the empty-state journey is rendered in place of the trace results pane
    And the journey starts on the `welcome` stage

  Scenario: Page chrome stays visible but inert while the journey is active
    When the Observe page loads with zero traces and the journey not dismissed
    Then the search bar is rendered with reduced opacity, `pointer-events: none`, and the `inert` attribute
    And the filter sidebar is rendered with the same dimmed inert treatment
    And focus, hover, and pointer events do not reach the dimmed chrome

  Scenario: Filter sidebar surfaces during the slice and outro chapters
    Given the journey has reached the `serviceSegue`, `facetsReveal`, or `outro` stage
    Then the filter sidebar is rendered without the dimmed inert treatment
    And the rest of the chrome (search bar, toolbar) remains dimmed inert

  Scenario: Skip dismisses the empty state for this project
    Given the empty-state journey is visible
    When the user clicks "Skip for now" or presses "K"
    Then the journey is hidden for this project (persisted in localStorage)
    And the real trace table is shown


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY STAGES (HERO COPY)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Journey stages drive hero copy and stage-specific affordances
  The journey is a linear sequence of stages defined in
  `onboardingJourneyConfig.ts`. Each stage owns its heading, subhead,
  optional CTA, and any stage-specific affordance (density spotlight,
  beadstrip, post-arrival countdown, outro panel).

  Background:
    Given the empty-state journey is visible

  Scenario: Typewriter beats auto-advance once their text finishes
    Given the current stage uses the typewriter hero
    When the typewriter completes
    Then the journey advances to the stage's `next` value automatically

  Scenario: Static beats with a `holdMs + next` advance after a timeout
    Given the current stage is a static hero with `holdMs` and `next` set
    Then the journey auto-advances to `next` after `holdMs` milliseconds
    And the timer pauses while the Integrate drawer is open

  Scenario: Replay restarts the current stage
    Given the user is on a stage that has already played
    When the user clicks "Replay"
    Then the stage's typewriter (or static enter animation) restarts from scratch

  Scenario: Back returns to the previous stage in history
    Given the journey has progressed past `welcome`
    When the user clicks "Back"
    Then the journey returns to the most recent prior stage

  Scenario: Density spotlight stage commits density on click
    Given the journey is on the `densityIntro` stage
    And the user has not previously confirmed a density preference
    When the user clicks one of the density preview cards
    Then that density is committed to `densityStore`
    And clicking the same card again advances to the next stage

  Scenario: Density spotlight is skipped if the user already confirmed a density
    Given `markDensityConfirmed` has been called in a prior session
    When the journey reaches the density spotlight stage
    Then the journey advances past it on entry without showing the spotlight

  Scenario: Post-arrival stage auto-opens the rich sample trace if the user does not click
    Given the journey is on the `postArrival` stage
    And the Integrate drawer is closed
    When 14 seconds elapse without a click on the highlighted row
    Then the trace drawer auto-opens for the rich arrival fixture trace
    And a visible countdown ("Or we'll open it for you in Ns.") indicates the timer

  Scenario: Opening the trace drawer during postArrival advances to drawerOverview
    Given the journey is on the `postArrival` stage
    When the trace drawer opens (via click or auto-open timer)
    Then the journey advances to the `drawerOverview` stage

  Scenario: Outro stage marks the journey completed
    Given the journey reaches the `outro` stage
    Then `markJourneyCompleted` is called so subsequent visits show a returning-user hub instead of the linear narrative


# ─────────────────────────────────────────────────────────────────────────────
# RETURNING USER HUB
# ─────────────────────────────────────────────────────────────────────────────

Rule: Returning users see a chapter-jump hub on welcome
  After the journey has been completed once for the user, re-entry
  via the toolbar's tour CTA lands them on the `welcome` stage but
  swaps the linear typewriter narrative for a `ReturningUserHub` of
  jump-to-this-bit cards.

  Background:
    Given `hasCompletedJourney()` returns true

  Scenario: Welcome shows the returning-user hub instead of the typewriter
    When the journey enters the `welcome` stage
    Then the `ReturningUserHub` is rendered in place of the welcome hero
    And the agent-handoff button, Integration overview link, and Skip footer items are hidden


# ─────────────────────────────────────────────────────────────────────────────
# INTEGRATE DRAWER (PAT MINTING + SETUP TABS)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Integrate drawer hosts PAT minting and setup paths
  The "Integrate my code" CTA opens a side `Drawer` that mints a PAT
  at the top and then exposes four setup tabs ("Skills", "MCP",
  "Prompt", "Manually"). The freshly-minted token flows into every
  setup body via `ActiveProjectProvider` so each path renders snippets
  pre-filled with the new credential.

  Background:
    Given the empty-state journey is visible
    And the user clicks "Integrate my code" (or presses "I")

  Scenario: Drawer opens with title and PAT card at the top
    Then the drawer titled "Send your own traces" is open
    And the `PatIntegrationInfoCard` is rendered at the top of the body
    And a tab strip is visible with: "Skills", "MCP", "Prompt", "Manually"
    And "Skills" is selected by default

  Scenario: Tab letter shortcuts switch tabs while the drawer is open
    When the user presses "S" / "M" / "P" / "I"
    Then the corresponding tab ("Skills" / "MCP" / "Prompt" / "Manually") becomes active

  Scenario: Manually tab shows the platform/framework picker and code preview
    When the user selects "Manually"
    Then a `PlatformGrid` lists every registered platform
    And selecting a platform updates the framework grid for that platform
    And the right-hand pane renders `InstallPreview` + `FrameworkIntegrationCode` + `DocsLinks` for the selection


# ─────────────────────────────────────────────────────────────────────────────
# PERSONAL ACCESS TOKEN GENERATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Generate access token inside the Integrate drawer
  `PatIntegrationInfoCard` mints a project-scoped PAT and surfaces it
  as a copyable env-var block. The token is lifted to the drawer so
  every setup tab can read it via `ActiveProjectProvider`.

  Background:
    Given the Integrate drawer is open

  Scenario: Initial state shows the generate-token card
    Then a card titled "Generate an access token" is visible
    And a "Generate access token" button is enabled

  Scenario: Generating creates a project-scoped PAT
    When the user clicks "Generate access token"
    Then a PAT is created via `personalAccessToken.create`
    And the PAT name is "Initial API key"
    And the binding is `{ role: MEMBER, scopeType: PROJECT, scopeId: projectId }`
    # TODO(traces-v2): Switch to a tracing-only custom role once one ships;
    # MEMBER is the closest preset that grants traces + prompts read/write.

  Scenario: Generated token is shown with env vars
    Given the user successfully generated a token
    Then the card shows env-var lines for `LANGWATCH_API_KEY`, `LANGWATCH_PROJECT_ID`, and `LANGWATCH_ENDPOINT`
    And `LANGWATCH_API_KEY` is masked behind a reveal toggle
    And a warning reminds the user the token is shown once

  Scenario: Token failure surfaces a toast
    Given the `personalAccessToken.create` mutation fails
    When the user clicks "Generate access token"
    Then a toast surfaces the error message
    And the generate button returns to its enabled state


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE DATA PREVIEW
# ─────────────────────────────────────────────────────────────────────────────

Rule: Sample data preview overlays fixture rows on the trace list
  During the journey the trace list is overridden by `useSamplePreview`,
  which serves fixtures from `samplePreviewTraces.ts` (no real OTLP
  POST happens). A persistent `SampleDataBanner` reads
  "Sample data — facets, filters, and the drawer all work, but
  nothing here is real." Pre-aurora stages see only
  `SAMPLE_PREVIEW_TRACES`; arrival-and-after stages also include
  `ARRIVAL_PREVIEW_TRACES` so the rich + simple "just arrived" rows
  appear at the top during the aurora beat.

  Background:
    Given the empty-state journey is visible

  Scenario: Banner appears whenever the preview is active
    When `usePreviewTracesActive()` returns true
    Then the `SampleDataBanner` is visible above the trace list
    And the banner reads "Sample data — facets, filters, and the drawer all work, but nothing here is real."

  Scenario: Arrival fixtures join the preview after the aurora chapter
    Given the journey has reached an arrival-and-after stage
    Then `ARRIVAL_PREVIEW_TRACES` rows are mixed with `SAMPLE_PREVIEW_TRACES` in the list

  Scenario: Free-text search applies a substring filter to the preview
    Given the preview is active
    When the user types into the search bar
    Then the visible preview rows are filtered with a loose substring match

  # @planned — "Explore with sample data" button + client-side OTLP POST
  # of `langwatch.sample`-tagged traces is not implemented as of
  # 2026-05-01. Today the preview is fixture-only and lives entirely
  # client-side; no traces are written to ClickHouse.


# ─────────────────────────────────────────────────────────────────────────────
# FIRST REAL TRACE CELEBRATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: First trace celebration
  When real traces arrive for the first time, the user sees a
  `CelebrationBanner` at the top of the trace results pane. The
  banner is dismissed manually — there is no auto-dismiss timer
  and no confetti animation as of 2026-05-01.

  Scenario: Banner reads when real traces arrive
    Given the project previously had zero traces
    When the first real trace arrives
    Then the `CelebrationBanner` is rendered with a "Your first traces are here!" headline
    And it includes a `PartyPopper` icon and a follow-up "Your integration is working. Traces will appear in real-time." line

  Scenario: Celebration banner can be dismissed manually
    Given the celebration banner is showing
    When the user clicks "Dismiss" on the banner
    Then the banner disappears immediately

  # @planned — Auto-dismiss after 10s, confetti burst, and a once-per-
  # project gate are not yet implemented as of 2026-05-01. The current
  # banner stays until manually dismissed.
