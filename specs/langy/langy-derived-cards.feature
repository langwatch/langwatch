Feature: Langy draws model-shaped data as derived cards, stamped by the relay
  As someone asking Langy about data the platform holds but does not compute,
  I want the answer drawn as a real card — clearly marked as Langy's own shaping —
  So that a dataset plot or a derived breakdown reads as a picture, not a wall of prose,
  and never passes itself off as a platform-measured result.

  # The model emits a fenced ```langy-card block inside its ordinary reply.
  # The RELAY extracts it, salvages the JSON (transport-tolerant), validates it
  # against the block kind's schema (boundary-strict), and stamps it as a typed
  # part in the durable event stream — the same one decision point every card
  # already inherits (ADR-059 card determinism, ADR-060). The browser never
  # parses fences out of text; time travel replays the same stamped part.
  #
  # Companion specs:
  #   - specs/langy/langy-choice-questions.feature (the choices block)
  #   - specs/langy/langy-capability-cards.feature (panel rendering of cards)
  #   - specs/langy/langy-event-sourced-frontend.feature (the fold these parts ride)
  #
  # ADR: dev/docs/adr/060-langy-model-emitted-blocks.md

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open on a conversation

  # ===========================================================================
  # One decision point — the relay stamps, everything downstream inherits
  # ===========================================================================

  Scenario: A block in the reply renders as a derived card
    Given Langy's reply contains a well-formed timeseries block between prose
    When the turn streams into the panel
    Then the prose renders as prose and the block renders as a chart card
    And the card sits where the block sat in the reply's flow

  Scenario: The browser renders the stamped part, never its own parse of the text
    Given a turn whose reply carried a derived card
    When the conversation is reloaded from history
    Then the same card renders from the recorded turn
    And the recorded reply text is not re-parsed to produce it

  Scenario: Time travel replays the derived card exactly as it rendered live
    Given a settled turn that produced a derived card
    When I scrub the inspector to a moment after the card settled
    Then the replayed view shows the same card the live view showed

  Scenario: A fence inside tool output never becomes a card
    Given a tool result whose text happens to contain a langy-card fence
    When the turn renders
    Then that fence renders as part of the tool result's raw content
    And no card is stamped for it

  # ===========================================================================
  # Transport-tolerant, boundary-strict
  # ===========================================================================

  Scenario: Mechanically damaged JSON is salvaged and still draws
    Given a block whose JSON was cut off with unclosed brackets
    When the relay can repair it into a document that validates
    Then the card renders from the repaired document

  Scenario: A block that validates nowhere renders as a disclosure, not a guess
    Given a block whose salvaged JSON fails its kind's schema
    When the turn renders
    Then a collapsed one-line disclosure appears in the block's place
    And expanding it shows the raw fenced text
    And no card of any kind is drawn from it

  Scenario: A failed block is never silently dropped
    Given a block that could not be salvaged at all
    When the turn renders
    Then the reply still accounts for the block with the disclosure line
    And the failure is counted for drift monitoring

  Scenario: A resource-shaped block is refused
    Given a block claiming a kind outside the derived-safe allowlist
    When the relay validates it
    Then it is treated as a failed block and renders as the disclosure
    And no traces, run, or created-resource card is drawn from it

  # ===========================================================================
  # Derived is visible, measured stays measured
  # ===========================================================================

  Scenario: Every derived card wears its provenance
    Given any card produced from a model-emitted block
    When it renders
    Then its chrome visibly marks it as derived by Langy
    And it is distinguishable at a glance from a platform-measured card

  Scenario: A derived card offers verification instead of pretending
    Given a derived card whose data the platform could compute for real
    When the card renders with a verify affordance
    Then activating it runs the real platform query
    And the measured result arrives as an ordinary measured card

  Scenario: An affordance hint the platform cannot validate is dropped
    Given a derived card hinting an explorer query that fails validation
    When the card renders
    Then no explorer link is shown
    And the card otherwise renders normally

  # ===========================================================================
  # Progressive rendering — preview by the same rules as settle
  # ===========================================================================

  Scenario: The card draws itself while the block streams
    Given a turn streaming a timeseries block
    When enough of the block has arrived to validate
    Then a forming card renders and grows as points arrive

  Scenario: A preview only shows what already validates
    Given a partially streamed block whose repaired prefix does not validate
    When the stream continues
    Then no card preview is shown until a validating prefix exists

  Scenario: The settled card replaces its own preview, never duplicates it
    Given a card previewed during the live stream
    When the turn settles and the stamped part arrives
    Then exactly one card renders, reconciled by the block's identity
    And on any disagreement the settled part's content wins
