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
  Scenario: The empty agents page shows samples when requested
    Given no organization-wide agent read exists
    And the viewer has enabled sample data
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

  # ===========================================================================
  # The fleet summary strip
  # ===========================================================================
  #
  # Four small cards pinned above the tabs, answering the four questions an
  # admin opens this page with: how many agents are there, are they working,
  # does anyone own them, and where is the money going.
  #
  # WHAT MAKES THIS HONEST. The page still issues no query — see the note at
  # the top of this file — so the strip is not a second, quieter place where
  # invented figures could pass as measured ones. Two rules keep it that way.
  #
  # First, every figure is derived from the same rows the cards below are drawn
  # from. Nothing in the strip is a separately invented number, so a reader who
  # adds up the cards gets the strip, and when an organization-wide read lands
  # and fills `GovernanceAgentRow` the strip lights up from the same code path
  # with no second set of figures to go and change.
  #
  # Second, the strip renders only when there are rows to summarize. It is
  # gated on having rows, not on sample mode, which is the same gate the filter
  # chips use. With nothing to summarize it is absent rather than showing four
  # em dashes: zero agents responding and no agents at all are different facts,
  # the pane below already says which one this is in a full sentence, and four
  # empty boxes above that sentence would say it again without saying it.
  #
  # The shape is the section's shared one (~/components/governance/summary),
  # built once for the pages that all needed a resume in the same round.

  @integration
  Scenario: The fleet summary strip sits above the tabs and above the filter chips
    Given the sample agent cards are on screen
    When a governance viewer opens the Agents page
    Then a strip of four cards is above the tab bar
    And the cards are headed Fleet, Health, Ownership and Top spenders
    And the strip sits below the banner that says nothing on the page is real
    And no filter chip is above it

  @integration
  Scenario: With nothing to summarize the strip is absent rather than showing zeroes
    Given no organization-wide agent read exists
    And the reader has turned sample data off
    When a governance viewer opens the Agents page
    Then no summary strip is on screen
    And the pane says instead that no agents are registered yet

  @unit
  Scenario: The fleet card counts the agents and captions the last thirty days
    Given the sample agent rows
    When the fleet summary is derived from them
    Then the fleet count is the number of rows, with the unit spelled out
    And the caption names how many registered in the last thirty days
    And the caption says the line beneath it is registrations over time

  @unit
  Scenario: The registration line rises to the size of the fleet
    Given the sample agent rows, each carrying how long ago it registered
    When the fleet summary is derived from them
    Then the line has one point per month of the last year
    And each point is the number of agents registered by that month
    And the line never falls, because an agent that registered stays registered
    And a row whose registration date was never measured is left off the line

  @unit
  Scenario: The health card lists responding, idle and erroring separately
    Given sample agents in different health states
    When the fleet summary is derived from them
    Then the health card carries one row for each of responding, idle and erroring
    And each row carries its own count and its own status dot
    And erroring is not inferred from how long ago an agent last ran

  @unit
  Scenario: An agent that has never run is counted in the fleet but in no health state
    Given a sample agent that has registered and never run
    When the fleet summary is derived from them
    Then it is included in the fleet count
    And it is counted in none of responding, idle or erroring
    And the three health counts therefore do not have to add up to the fleet

  @unit
  Scenario: The ownership card names the sources the unclaimed agents came from
    Given some sample agents carry an owner and some do not
    When the fleet summary is derived from them
    Then the ownership card carries an owned count and an unclaimed count
    And the unclaimed row names the sources those agents came from, in full words
    And with nothing unclaimed the row names no sources at all

  @unit
  Scenario: Top spenders rank by share of the spend we actually measured
    Given sample agents whose spend was measured and one whose spend was not
    When the fleet summary is derived from them
    Then the three highest spenders are listed, biggest share first
    And each share is a whole percentage of the spend the platform measured
    And an agent whose spend was never measured is neither ranked nor counted in the total
