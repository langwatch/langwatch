Feature: Langy consumes the event-sourced backend with optimized fetches and lightweight signals
  As a user chatting with Langy while it works across a project
  I want the conversation list, history, and live turns to stay fresh without heavy polling
  So that Langy feels instant and never re-downloads data it already has

  # Frontend PR stacked on the event-sourced Langy backend (ADR-046, PR2).
  #
  # ADR-049 keeps canonical events in ClickHouse and moves Langy's operational
  # conversation, turn, and message projections to Postgres. The frontend
  # contract stays signal-then-refetch: never push a row over the real-time
  # channel. Heavy message history remains a separate on-demand read from the
  # slim conversation list.
  #
  # Companion specs:
  #   - specs/langy/langy-event-sourced-conversations.feature (backend)
  #   - specs/langy/langy-navigation-persistence.feature (lifecycle)

  Background:
    Given I am signed in with Langy enabled for project "demo"
    And the Langy panel is open on a page of "demo"

  # ---------------------------------------------------------------------------
  # Optimized fetch: slim list + heavy detail split
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The recent-chats list reads the slim Postgres conversation state
    When Langy loads my recent conversations
    Then it fetches only the slim conversation spine (id, title, status, counts, last activity)
    And it does not fetch any message content for the list
    And previously loaded pages stay visible while a newer page is fetching

  @integration
  Scenario: Message history is fetched on demand, separately from the list
    Given the recent-chats list is loaded
    When I open a specific conversation
    Then its messages are fetched on demand from the message projection
    And the slim list is not re-fetched to obtain them

  @integration
  Scenario: A stale in-flight list response cannot overwrite a fresher one
    Given a conversation list request is in flight
    When a freshness signal triggers a newer list request
    Then the in-flight request is cancelled before the newer one is invalidated
    And the view only ever shows the freshest data

  # ---------------------------------------------------------------------------
  # Real-time: one page-level coordinator, signal-then-refetch (never a push)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A conversation update arrives as a signal, not as data
    When the backend broadcasts that a conversation changed
    Then Langy receives only a lightweight signal carrying the conversation id
    And it cancels and invalidates the affected queries rather than accepting pushed rows
    And the "N new" counter stays accurate across the update

  @integration
  Scenario: A single SSE subscription serves the whole panel
    Given the Langy panel is mounted
    Then exactly one SSE subscription is opened for conversation freshness
    And additional list or detail consumers reuse that one coordinator

  @integration
  Scenario: Polling only runs when the live signal is disconnected
    Given the freshness SSE is connected
    Then the new-count query does not poll on an interval
    When the freshness SSE disconnects
    Then the new-count query falls back to adaptive polling
    And the interval backs off as consecutive polls come back empty

  # ---------------------------------------------------------------------------
  # Live turn streaming (the one thing that genuinely streams)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The in-flight turn streams tokens while everything else is signal-then-refetch
    When Langy is answering my message
    Then the answer tokens stream directly from the turn stream
    And each revealed word transitions from blurred to sharp with a slight upward drift
    And any metric Langy reports animates with a spring number ticker
    And reduced-motion users see the words and numbers appear without animation

  @integration
  Scenario: Granular streaming states drive distinct UI
    When Langy reports a status like "Analysing 1,204 traces"
    Then a live status line shows that message
    When Langy reports progress toward completion
    Then a progress bar reflects the percent or segment
    And the shimmer thinking indicator remains while no status is present

  @integration @unimplemented
  Scenario: A turn in flight resumes after a page refresh
    # Depends on the PR3 Redis token-buffer transport; the UI reads turn state
    # and replays the buffered tail.
    Given Langy is streaming a response
    When I refresh the page
    Then Langy shows "Catching up…" while it reattaches to the in-flight turn
    And it replays the buffered token tail and continues streaming

  # ---------------------------------------------------------------------------
  # Domain-error rendering (ADR-045)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A handled stream error renders a useful explanation, not a raw string
    When a turn fails with a handled domain error
    Then the stream carries the serialized domain error, not a plain string
    And Langy renders a titled explanation keyed on the error kind

  @integration
  Scenario: Not-connected and no-data conditions are suppressed, not shown as errors
    When Langy has no data source connected
    Then Langy shows the connect card or empty state
    And it does not show a red error

  @integration
  Scenario: An unknown error stays calm and traceable
    When a turn fails with an error Langy does not recognise
    Then Langy shows a single calm generic message
    And it surfaces a trace id for support

  # ---------------------------------------------------------------------------
  # Visual contract
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The primary accent is LangWatch tracing orange
    Then Langy's focus, active, send, and link accents use the orange brand token
    And the AI mesh gradient is reserved for the sparkle badge and AI moments only

  @integration
  Scenario: The composer is one integrated surface
    Then context chips, the input, and the model picker with send share one bordered surface
    And opened page context (an experiment or trace) rides as a removable chip inside the composer

  # The thinking line may only say true things (see langyThinkingLine.ts). Live
  # reasoning IS the model working, so it must never read as "Starting up…".
  @unit
  Scenario: Live reasoning reads as thinking, not as starting up
    Given a turn is in flight with no prose and no tool call yet
    And the model's reasoning is streaming live
    Then the thinking line says the model is thinking
    And it does not claim Langy is still starting up

  # Reasoning is ambience, not the reply: mostly quiet, periodically a taste.
  # Text that moves cannot be comfortably read (drifting words fight the
  # reading eye), so a glimpse fades in place and never scrolls or ticks.
  @unit
  Scenario: Reasoning surfaces as periodic glimpses of the latest thought
    Given a turn is in flight and the model's reasoning is streaming
    Then the thinking line periodically shows the latest complete thought
    And the glimpse fades in, holds long enough to read, and dissolves
    And the line is quiet between glimpses
    And nothing on the line ever changes position

  @unit
  Scenario: A glimpse never repeats a thought the user already saw
    Given no new complete thought has finished since the last glimpse
    When fresh reasoning words have still arrived
    Then the next glimpse shows a small taste of the freshest words
    But when nothing new has arrived at all, no glimpse appears

  @unit
  Scenario: Clicking the thinking line reveals the full reasoning
    Given a turn is in flight with reasoning streaming
    When the user clicks the thinking line
    Then the full reasoning stream opens beneath it, following the live edge
    And clicking again collapses it
    And it collapses on its own when the turn settles
