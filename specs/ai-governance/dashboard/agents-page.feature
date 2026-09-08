Feature: The AI Governance Agents page
  As an admin who has to answer "what is running against this organization"
  I want one page listing every agent, what it costs and who owns it
  So that I can find the unclaimed and the expensive ones without asking around

  # ---------------------------------------------------------------------------
  # The Agents page is a tabbed surface — Agents and Applications — whose tab
  # contract lives in specs/ai-gateway/governance/governance-home-routing.feature.
  # This file covers what the Agents tab holds: the sample-data toggle, the
  # register action, the filter chips and the agent cards.
  #
  # WHAT IS REAL HERE. Nothing on this page is measured yet. Every agents
  # procedure the platform has is project-scoped (`agents.getAll`, permission
  # `evaluations:view`); the governance section is organization-scoped, so
  # reading one project's agents and labelling them as the organization's
  # would be a lie told in the house typeface. Until an organization-wide read
  # lands, the page issues no query at all: sample mode fills the empty page,
  # and with sample mode off each pane says plainly that nothing has been
  # detected.
  #
  # WHY REGISTERING IS A CODE SNIPPET AND NOT A FORM. ADR-128 makes a connected
  # agent register itself: the customer decorates the function that runs the
  # agent and the SDK opens the socket. The platform refuses to create one from
  # a form — `AgentService.create` throws `agent_register_only` for a connected
  # agent, and so does the tRPC mutation before it. So "Register agent" opens
  # the connect-from-code flow rather than a name-and-environment form; a form
  # here would collect fields nothing could persist.
  #
  # Rulebook: specs/ai-governance/dashboard/governance-ui-controls.feature
  # ADR: dev/docs/adr/128-connected-agents.md
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @integration
  Scenario: The empty agents page fills itself with sample agents
    Given no organization-wide agent read exists
    When a governance viewer opens the Agents page
    Then sample agent cards are on screen
    And the banner says nothing on the page is real

  @integration
  Scenario: Turning sample data off leaves the honest empty pane
    Given the sample agent cards are on screen
    When the reader turns sample data off
    Then no agent card remains
    And the pane renders the page's own empty state, headed
      "No agents registered yet"
    And that empty state offers a way to register one
    And the banner is gone

  # ---------------------------------------------------------------------------
  # Empty states. One shared shape (~/components/governance/empty), three
  # different sets of words, because a page that has nothing to show still has
  # something to say and it is never the same sentence twice.
  #
  # The rule that matters most is the last scenario in this block. A reader
  # holding ten agents who filtered nine of them out of view has not arrived at
  # an empty page; they have arrived at a filter that is too narrow, and telling
  # them to go register an agent is the page failing to read its own state. The
  # shared component cannot enforce this, because it cannot see WHY the list is
  # empty. Only the page knows, so the page decides.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every empty state on the page carries a way out
    Given no organization-wide agent read exists
    And the reader has turned sample data off
    When a governance viewer opens the Agents page
    And they open the Applications tab
    Then each pane renders an empty state with a glyph, a headline, a sentence
      and a button
    And neither pane is a bare sentence in a dashed box

  @integration
  # Title kept on one line: the parity checker's title group cannot cross a
  # newline, so a wrapped title binds a phantom that matches no scenario.
  Scenario: Filtering everything out offers the filters back, not a registration
    Given the sample agent cards are on screen
    When the reader picks a source and an ownership that no agent satisfies
    Then the pane says no agent matches these filters
    And the way out is clearing the filters, not registering an agent
    And clearing them brings the cards back

  @integration
  Scenario: The sample toggle and the register action sit in the page header
    When the Agents page renders
    Then both sit in the header row beside the page title
    And neither is offered anywhere else on the page

  # ===========================================================================
  # Registering an agent
  # ===========================================================================

  @integration
  Scenario: Register agent opens the connect-from-code flow
    When the reader chooses Register agent
    Then a dialog explains that an agent registers itself from the process that runs it
    And it shows the Python and the TypeScript snippet that does it
    And it collects no fields, because nothing could persist them

  @integration
  Scenario: An address asking for the register dialog opens it on arrival
    When a governance viewer opens the Agents page with "add=1" in the address
    Then the register dialog is open

  @integration
  Scenario: Closing the register dialog takes the request out of the address
    Given the register dialog was opened from the address
    When the reader closes it
    Then the address no longer carries "add"

  # ===========================================================================
  # Filters and sort
  # ===========================================================================

  @integration
  Scenario: Source and ownership are filter chips beside the sort chip
    When the Agents page renders
    Then a Source chip, an Ownership chip and a Sort chip are in one row under the header
    And no native select element exists anywhere on the page

  # The controls that narrow the content do not live inside it. The api keys
  # settings page is the house pattern: its scope filter and its create action
  # share a header row above a table that always renders something.
  @integration
  Scenario: The filter row sits outside the content it narrows
    When the Agents page renders
    Then no filter chip is inside the tab content region
    And the Applications tab, which has nothing to filter, renders no chips

  @integration
  Scenario: Filtering by source leaves only that source's agents
    Given sample agents from several sources
    When the reader picks a single source
    Then only that source's cards remain

  @integration
  Scenario: Ownership filters down to the agents nobody has claimed
    Given some sample agents carry an owner and some do not
    When the reader picks Unclaimed only
    Then only the cards with no owner remain
    And each of them carries the Unclaimed badge

  @integration
  Scenario: A filter choice is part of the address
    When the reader picks a source and an ownership and a sort order
    Then each choice is written to the address
    And opening that address again applies all three

  @integration
  Scenario: Sorting reorders the cards
    Given sample agents with different spend
    When the reader sorts by requests instead
    Then the card order follows the request counts

  # ===========================================================================
  # What a card says
  # ===========================================================================

  @integration
  Scenario: A card names the agent, where it runs, who owns it and what it costs
    When a sample agent card renders
    Then it carries the agent's name and environment
    And its owner, its models and its source
    And its spend, its request count and when it was last active

  @integration
  Scenario: A figure the platform does not have reads as a dash, never a zero
    Given a sample agent that has never been called
    When its card renders
    Then its spend and request count read as a dash
    And the dash explains itself on hover
