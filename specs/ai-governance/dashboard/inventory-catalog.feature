Feature: The Inventory catalog is the tools the organization runs
  As an admin about to renew a contract
  I want one card per AI tool, saying what it costs and who uses it
  So that I can see the tool nobody uses before I pay for it again

  # ---------------------------------------------------------------------------
  # WHAT A CARD IS. One registered tool. The registry is `AiToolEntry` — the
  # rows an admin creates and the starter pack seeds — and it is the same list
  # the personal AI-tools portal launches from and the command line reads for
  # each tool's path policy.
  #
  # It was briefly something else, and the correction is the reason this file
  # reads the way it does. The pane derived a "tool" from each configured
  # ingestion source, on the reading that a tool entered the system by being
  # connected. A source is a pipe, so the catalog listed the admin billing
  # connectors as if they were tools the organization had bought, and the one
  # figure it could fill — a source's 24-hour event count — was a real number
  # about the wrong thing. Both are gone. Nothing on this screen joins a tool
  # to a source, and no reading of a source stands in for a reading of a tool.
  #
  # THE MEASUREMENT RULE THIS FILE EXISTS FOR. Every figure on a card is
  # measured or it is absent. On this branch that means NO row of a real card
  # is measured: spend, attribution, volume and seats are all keyed by
  # organization or by ingestion source, and none of them narrows to one
  # registered tool. Each row shows an em dash carrying the sentence that says
  # what would fill it. It never shows a plausible number, and sample mode
  # never fills a real card in: the samples are a separate list of invented
  # tools, under their own badge.
  #
  # THE APPLICABILITY RULE, which is a different question. A row either applies
  # to a tool or it does not, and that is decided by how the tool is paid for
  # and what it is. Seats do not apply to a coding assistant each person runs
  # on their own plan — there is no seat list to read and no seat to leave
  # unassigned — so a Seats row there would be a permanent dash promising a
  # read nobody will build. A card draws only the rows its tool has. The table
  # cannot, because its columns are fixed, so it draws an em dash saying the
  # row does not apply.
  #
  # Implementation:
  #   - platform/app/ee/governance/dashboard/components/toolCatalog/
  #   - platform/app/ee/governance/dashboard/logic/inventorySummary.ts
  #   - platform/app/ee/governance/dashboard/pages/inventory.tsx
  #
  # Companion specs:
  #   - specs/ai-governance/dashboard/governance-ui-controls.feature
  #   - specs/ai-governance/dashboard/inventory-environments.feature
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # What the catalog lists
  # ===========================================================================

  @integration
  Scenario: A registered tool is a card carrying its name and its vendor
    Given the organization has registered a tool
    When the Catalog pane renders
    Then a card for that tool is on screen
    And it carries the tool's own name and the vendor it comes from

  @integration
  Scenario: The catalog lists registered tools and not ingestion sources
    Given the organization has connected sources and registered tools
    When the Catalog pane renders
    Then only the registered tools are on screen
    And no connected source appears as a tool
    # The connectors are how the data arrives. Listing one as a tool put a
    # billing pipe on the screen someone reads before signing a renewal.

  @integration
  Scenario: A tool registered but not published is still in the catalog
    Given a registered tool nobody in the organization can launch yet
    When the Catalog pane renders
    Then the tool is listed
    And it is marked as not published
    # An inventory that hid it would report a tool the organization is still
    # paying for as one it does not have.

  @integration
  Scenario: The catalog stays hidden from a reader without the registry grant
    Given a reader who may see the governance section but not manage tools
    When the Catalog pane renders
    Then the pane says which grant the catalog needs
    And the tab strip is still in place
    # The whole registry is the admin read. The per-member read is scoped to
    # each person's departments and would give two readers two different
    # inventories, which is not an inventory.

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
  Scenario: A tool billed on consumption is not shown as having no seats
    Given a tool nobody buys a seat for
    When its card renders in sample mode
    Then the seats row says it is billed on consumption
    And it does not read as a seat count of zero
    # SAMPLE MODE ONLY, and the one place the two surfaces differ. A sample
    # card's rows are hand-authored, and these two keep a seats row carrying a
    # sentence instead of dropping it: "billed on consumption" is the answer a
    # buyer arrives with, and an absent row would let them assume nobody
    # looked. A REGISTERED tool's rows are derived instead, and there the seats
    # row is genuinely absent — see "A consumption-billed tool carries the
    # token count it is billed on" below, which is the rule for that path and
    # does not contradict this one.

  # ===========================================================================
  # Which rows a tool has
  # ===========================================================================

  @unit @integration
  Scenario: A row that does not apply to a tool is left off its card
    Given a coding assistant each person runs on their own plan
    When its card renders
    Then it carries a subscriptions row
    And it carries no seats row and no licence cost row
    And it carries no token count, which would repeat the usage figure
    And it carries no agent count and no conversation count
    # Worked through on the assistant the product owner used as the example.
    # The rule generalises from how a tool is paid for, not from that one tool.

  @unit
  Scenario: A seat-licensed tool carries seats and unassigned licence cost
    Given a tool whose vendor bills an administrator per named seat
    When its rows are worked out
    Then it carries seats, licence per month and unassigned licence cost
    And it carries no subscriptions row
    # Unassigned seats are money already spent, and finding them is what a
    # renewal review is for.

  @unit
  Scenario: A consumption-billed tool carries the token count it is billed on
    Given a tool billed on what it consumed
    When its rows are worked out
    Then it carries a token count
    And it carries no seats row and no subscriptions row
    # The token row survives only here. Where the contract fixes the money, the
    # tokens move nothing a reader could act on and the row is the usage figure
    # told twice. Where tokens ARE the billed unit they separate from the
    # dollars the moment a price changes, which is the question being asked.

  @unit
  Scenario: An in-house tool carries its agents and its conversations
    Given a tool the organization built and runs itself
    When its rows are worked out
    Then it carries an agent count and a conversation count
    And it carries no payment row, because there is no contract to read

  # ===========================================================================
  # Registering a tool
  # ===========================================================================

  @integration
  Scenario: Registering a tool opens the registration drawer
    Given an admin who may manage the tool registry
    When they press Add tool
    Then the tool registration drawer opens
    # The SAME drawer the tool-catalog editor opens. A second registration form
    # over one registry is how two surfaces end up disagreeing about what a
    # tool is.

  @integration
  Scenario: The add deep link opens the registration drawer
    Given a link addressed at the catalog pane with the add flag set
    When the page opens on that address
    Then the tool registration drawer is open
    And the flag is dropped from the address afterwards
    # So a refresh or a back-button does not reopen the drawer the reader just
    # dismissed.

  @integration
  Scenario: A tool row offers edit, publish and remove in one menu
    Given a registered tool on the catalog
    When the reader opens that tool's actions
    Then edit, publish and remove are all in the one overflow menu

  @integration
  Scenario: A sample card offers no action that would act on a real tool
    Given sample mode is on
    When the Catalog pane renders
    Then no card offers a row action

  @integration
  Scenario: The tile editor and the starter pack stay off this page
    Given the Inventory page renders
    When the Catalog pane is in view
    Then no drag-to-reorder editor and no starter-pack import is on screen
    # An inventory is read, not arranged. Ordering decides how the personal
    # portal renders, which is the catalog editor's job.

  # ===========================================================================
  # Grid and table
  # ===========================================================================

  @integration
  Scenario: The catalog is offered as a grid or as a table
    Given the Catalog pane is in view
    When the reader switches the layout to list
    Then the tools render as a table, one row each
    And the switch is not a native select
    # The list used to be the same tall card stacked in one column, which spent
    # the whole width on one tool and made the comparison a list is asked for
    # impossible.

  @integration
  Scenario: Table headers are spelled out rather than abbreviated
    Given the catalog is rendered as a table
    When its headers are read
    Then every column is spelled out in full
    And no header is shortened to a slash, an initial or a single letter
    # The design reference abbreviated three of them. A shortened header saves
    # a few pixels and costs the reader a guess, and a money column is where a
    # wrong guess is most expensive.

  @integration
  Scenario: A column a tool has no row for shows a dash saying so
    Given a table column for a row one of the tools does not have
    When that tool's row renders
    Then the cell shows a dash
    And the dash says the row does not apply to that tool
    # A table's columns are fixed for every row, so the cell cannot be left
    # out. Two emptinesses, said differently: one will never fill, the other is
    # waiting on a read that is named.

  # ===========================================================================
  # The resume strip
  # ===========================================================================

  @unit @integration
  Scenario: A strip above the tabs resumes each pane
    Given the Inventory page renders
    When the strip is read
    Then it says how many tools, environments and sources there are
    And each figure carries the one fact worth knowing about that pane

  @integration
  Scenario: The Sources pane no longer repeats the strip's own count
    Given the strip says how many sources there are and how many are active
    When the Sources pane renders
    Then it carries no heading repeating those two figures

  @unit @integration
  Scenario: A figure the page cannot measure is a dash, never a zero
    Given a reader who cannot see the tool registry
    When the strip renders
    Then the tool count is a dash
    # Zero is a measurement. "You run no tools" is a different sentence from
    # "we cannot tell you", and only one of them is true here.

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @integration
  Scenario: Sample mode replaces the cards rather than filling them in
    Given the reader turned sample data on
    When the Catalog pane renders
    Then the cards on screen are the sample tools
    And no card built from the real registry is on screen
    # Substitution, never mixing. A screen that filled a real card's empty rows
    # with invented ones would be the exact failure this whole file guards.

  @integration
  Scenario: Every sample card says it is a sample
    Given sample mode is on
    When the Catalog pane renders
    Then each card carries the sample badge

  @unit
  Scenario: Sample sources are the connectors the product offers, named as the menu names them
    Given sample mode is on
    When the sample sources are worked out
    Then every row is a source type the Add source menu offers
    And each row carries that type's catalog name rather than one coined for the sample
    # The rows used to be built from the sample TOOL cards, so the Sources tab
    # listed a "ChatGPT Enterprise" connector and a "Custom Agents" one.
    # Neither is a thing anyone can connect, and a reader who switched the
    # samples off and opened Add source found none of what they had just been
    # shown. Sample data may invent an INSTANCE — whether this organization's
    # connection is healthy, when data last arrived — never a source type and
    # never a name for one.

  @unit
  Scenario: A retired source type is offered as a sample no more than it is offered for real
    Given a source type the catalog has retired
    When the sample sources are worked out
    Then no sample row is on that type
    # One filter, read by the Add source menu and by the sample alike. Two
    # would let a retired connector come back on one screen after being pulled
    # from the other.

  @unit
  Scenario: A type held back from the sample is still offered in the Add source menu
    Given the Anthropic Claude Cowork source type is held back from the sample
    When the sample sources are worked out
    Then no sample row is on that type
    And the Add source menu still offers it
    And it is not marked retired
    # The sample and the menu answer different questions, so they are allowed
    # to differ in one direction only: the sample is a subset. The menu says
    # what a customer can connect and must stay complete; the sample says what
    # a connected fleet looks like, and a row there reads as a claim about
    # THIS deployment. Cowork is held back on that ground alone. It is current,
    # pickable and fully configurable — anyone reading the flag as a wind-down
    # and finishing the job by retiring the type would break a live connector.

  @integration
  Scenario: A source named after its own type does not say so twice
    Given a source whose name is the name of its type
    When its row renders
    Then the type is written once
    # The type sits under the name to say what a source somebody called
    # "Anthropic spend" actually is. A source named after its own type has
    # nothing left to explain.

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
  Scenario: The tab says how many tools are in the catalog
    Given the catalog holds tools
    When the tab strip renders
    Then the Catalog tab carries that count
    And it counts registered tools rather than connected sources

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
    Given a card carrying a usage cost and a seat sentence
    When the card renders
    Then both read exactly as written, with no shortening applied
    # Counts are stored as numbers and formatted at render; anything already
    # shaped for reading is stored as its string. The type is the rule, so no
    # formatter has to guess whether a figure is tokens or dollars.
