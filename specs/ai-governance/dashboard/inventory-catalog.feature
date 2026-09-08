Feature: The Inventory catalog is the tools the organization runs
  As an admin about to renew a contract
  I want one card per AI tool, saying what it costs and who uses it
  So that I can see the tool nobody uses before I pay for it again

  # ---------------------------------------------------------------------------
  # The Catalog pane used to be the tool-tiles editor: a drag-orderable grid of
  # launcher tiles, plus a "Publish a starter pack" button that imported coding
  # assistants and model providers. Tiles are a real feature and they are not
  # deleted — the personal AI-tools portal renders them as its launcher, and the
  # CLI reads the coding-assistant tiles for each tool's path policy (gateway
  # versus direct OTLP). They are simply not an inventory: they say what a
  # person may click, not what the organization runs and pays for. So they leave
  # this page and keep their two consumers.
  #
  # What replaces them is the catalog a buyer reads: one card per tool, with
  # seats, licence spend, idle spend, usage, attribution and volume.
  #
  # THE RULE THIS FILE EXISTS FOR. Every figure on a card is measured or it is
  # absent. Most of these rows have no read on this branch — spend and
  # attribution are rolled up per organization, not per tool, and the seat
  # counts drop the source that reported them before they reach the client. A
  # card shows those rows as an em dash carrying the sentence that says what
  # would fill it. It never shows a plausible number, and sample mode never
  # fills a real card in: the samples are a separate list of invented tools,
  # under their own badge, so an invented figure cannot reach a card built from
  # a real source.
  #
  # Implementation:
  #   - platform/app/ee/governance/dashboard/components/toolCatalog/
  #   - platform/app/ee/governance/dashboard/pages/inventory.tsx
  #
  # Companion specs:
  #   - specs/ai-governance/dashboard/governance-ui-controls.feature
  #   - specs/ai-governance/dashboard/inventory-environments.feature
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # What a card says
  # ===========================================================================

  @integration
  Scenario: A registered tool is a card carrying its name and its vendor
    Given the organization has connected a source for a tool
    When the Catalog pane renders
    Then a card for that tool is on screen
    And it carries the tool's own name and the vendor it comes from

  @integration
  Scenario: A row nothing measures shows a dash naming what would fill it
    Given a tool whose seats, spend and attribution are not read per tool
    When its card renders
    Then each of those rows shows a dash rather than a number
    And the dash carries the sentence saying what would fill that row
    # This is the whole point of the card. A renewal decision made off an
    # invented figure is worse than one made off an admitted gap, and a number
    # set in the same typeface as a measured one reads as measured.

  @integration
  Scenario: The one row this branch measures carries its real figure
    Given a source that delivered events in the last day
    When its card renders
    Then the events row shows that count
    And it is labelled with the window it was actually counted over
    # Twenty-four hours, said as twenty-four hours. Labelling a day's count as
    # thirty days would be the same lie as inventing one.

  @integration
  Scenario: A tool billed on consumption is not shown as having no seats
    Given a tool nobody buys a seat for
    When its card renders in sample mode
    Then the seats row says it is billed on consumption
    And it does not read as a seat count of zero

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @integration
  Scenario: Sample mode replaces the cards rather than filling them in
    Given the reader turned sample data on
    When the Catalog pane renders
    Then the cards on screen are the sample tools
    And no card built from a real source is on screen
    # Substitution, never mixing. A screen that filled a real card's empty rows
    # with invented ones would be the exact failure this whole file guards.

  @integration
  Scenario: Every sample card says it is a sample
    Given sample mode is on
    When the Catalog pane renders
    Then each card carries the sample badge

  @integration
  Scenario: A failed read raises no alert while sample mode is on
    Given the source list failed to load
    And sample mode is on
    When the page renders
    Then no error alert is on screen
    # The banner has already said nothing on the page is real. An alert about
    # the read behind data the reader is not looking at is noise.

  # ===========================================================================
  # Controls
  # ===========================================================================

  @integration
  Scenario: The catalog is offered as a grid or as a list
    Given the Catalog pane is in view
    When the reader switches the layout to list
    Then the same cards render in a single column
    And the switch is not a native select

  @integration
  Scenario: Adding a tool opens the same menu that adds a source
    Given an admin who may manage sources
    When they open Add tool
    Then the menu offers the same tools the Add source menu offers
    # A tool enters the system by being connected as a source. Two different
    # front doors onto one act would leave a reader wondering which one they
    # just walked through.

  @integration
  Scenario: The tab says how many tools are in the catalog
    Given the catalog holds tools
    When the tab strip renders
    Then the Catalog tab carries that count

  # ===========================================================================
  # What left the page
  # ===========================================================================

  @integration
  Scenario: The tool tiles and the starter pack are gone from this page
    Given the Inventory page renders
    When the Catalog pane is in view
    Then no tile editor, tile section or starter-pack action is on screen
    # Tiles keep their two consumers — the personal AI-tools portal and the
    # command line's tool-path policy. Only this page stops rendering them.

  # ---------------------------------------------------------------------------
  # Reading the figures
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A count of a million or more is shortened on the card
    Given a tool whose token count for the last 30 days is 412,900,000
    When the card renders
    Then the row reads "412.9M"
    # Nine digits against a short label cannot be compared card to card: the
    # reader is comparing 413 against 204 and paying for the digits. The rule
    # is a threshold on the value, not a choice per row, so an organization
    # whose event count reaches eight digits gets the same relief.

  @integration
  Scenario: A count below a million is left exact and grouped
    Given a tool whose events in the last 24 hours number 22,180
    When the card renders
    Then the row reads "22,180" in full
    # Below a million the digits are still read at a glance, and shortening
    # would trade exactness for nothing.

  @integration
  Scenario: A shortened count keeps its exact value on hover
    Given a card row showing a shortened count
    When the reader hovers it
    Then the exact figure is offered, and it is the row's accessible name too
    # The short form is a reading aid, never the only place the figure lives.

  @integration
  Scenario: Money and prose rows are never shortened
    Given a card carrying a monthly licence cost and a seat sentence
    When the card renders
    Then both read exactly as written, with no shortening applied
    # Counts are stored as numbers and formatted at render; anything already
    # shaped for reading is stored as its string. The type is the rule, so no
    # formatter has to guess whether a figure is tokens or dollars.
