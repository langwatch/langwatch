Feature: The AI Governance Agents page
  As an admin who has to answer "what is running against this organization"
  I want one page listing every agent, what it costs and who owns it
  So that I can find the unclaimed and the expensive ones without asking around

  # ---------------------------------------------------------------------------
  # The Agents page is one surface: the agents, and the controls above them.
  # Its address contract lives in
  # specs/ai-gateway/governance/governance-home-routing.feature. This file
  # covers what the page holds: the sample-data toggle, the register action,
  # the filter chips, the layout switch, and the two layouts themselves.
  #
  # IT WAS TABBED AND IS NOT ANY MORE. An Applications tab sat beside the
  # agents, and the pane behind it read nothing and listed nothing — a fixed
  # empty state waiting for a concept the platform does not model. The product
  # owner asked for it gone. With one pane left there was nothing to switch
  # between, so the tab strip went too.
  #
  # THE LIST IS THE DEFAULT AND THE CARDS ARE THE OPTION. The question this
  # page is opened with — what is running across this organization — is a
  # comparison across agents, and a grid of cards answers it a panel at a
  # time. The switch between the two is the inventory catalog's control, down
  # to its words, so a reader who learned it on one governance screen finds it
  # here.
  #
  # WHAT IS REAL HERE. The rows are real, and the figures on them are not yet.
  # `governanceAgents.list` reads two organization-scoped tables: agents that
  # registered themselves from code (ADR-128) and agents a connected provider
  # was asked to list. Neither measures spend, request counts or health per
  # agent, so a real row leaves those null and the page draws a dash with the
  # reason on it.
  #
  # SAMPLE MODE IS AN EITHER-OR, NEVER A FALLBACK. With it on the page shows
  # the invented set and says so; with it off it shows what the read returned,
  # including an empty answer. An organization with no agents is never quietly
  # filled with plausible ones: a reader cannot act on invented figures, and
  # cannot tell they are invented if they arrived because the real answer was
  # empty. The spinner and the failure alert are suppressed under sample mode
  # for the same reason, which is the stance the Costs and People pages take.
  #
  # WHY REGISTERING IS A CODE SNIPPET AND NOT A FORM. ADR-128 makes a connected
  # agent register itself: the customer decorates the function that runs the
  # agent and the SDK opens the socket. The platform refuses to create one from
  # a form — `AgentService.create` throws `agent_register_only` for a connected
  # agent, and so does the tRPC mutation before it. So "Register agent" opens
  # the connect-from-code flow rather than a name-and-environment form; a form
  # here would collect fields nothing could persist.
  #
  # AND IT IS A DRAWER, NOT A MODAL. It was a modal; the section's one create
  # surface is the right-side drawer, so it is now registered as `addAgent` and
  # mounted by `CurrentDrawer` like every other. That buys the address: the
  # drawer reopens from a paste and browser back closes it. `?add=1` is kept as
  # the short href another screen can hold — the page honours it once, asks for
  # the drawer, and drops the parameter, exactly as the people page does with
  # its own `add=1`.
  #
  # Rulebook: specs/ai-governance/dashboard/governance-ui-controls.feature
  # ADR: dev/docs/adr/128-connected-agents.md
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # What the page reads
  # ---------------------------------------------------------------------------
  # Two tables that never meet. A LangWatch-native agent registers itself from
  # the process that runs it; a provider-side agent is found by asking the
  # provider. An admin asking what runs against the organization means both.
  #
  # The union rule is deliberately narrow. Names are the only signal the two
  # tables share, so an agent found under both origins is collapsed only on an
  # exact name (ignoring case and surrounding space), and the registered record
  # is the survivor because it is the one with an owner, an environment and a
  # real registration date.
  # ===========================================================================

  @unit
  Scenario: The list holds the agents we registered and the agents we found
    Given the organization has registered a connected agent from code
    And a connected provider has named an agent of its own
    When the agents list is built
    Then both agents are listed
    And each says which of the two it came from

  @unit
  Scenario: An agent a provider named carries no owner and no environment
    Given the only agents are ones a provider named
    When the agents list is built
    Then each is listed as unclaimed
    And its environment reads as not declared
    # The provider names a workspace or a tenant address, which is a place and
    # not a deployment stage, so it never fills the environment column.

  @unit
  Scenario: A figure no read measures stays empty rather than becoming a zero
    Given the agents list is built from real rows
    Then no row claims a spend, a request count or a health state
    And an agent a provider named claims no last-active time either
    # The provider lists every agent it holds on every sync, so "last seen" is
    # a fact about the sync and never about the agent being called.

  @unit
  Scenario: A registered agent is dated from when it registered
    Given a connected agent registered ninety days ago and was last seen an hour ago
    When the agents list is built
    Then the row says it registered ninety days ago
    And it says it was last active an hour ago
    And it names the member who owns it

  @unit
  Scenario: An agent found under both origins is listed once
    Given a connected agent and a provider agent share a name
    When the agents list is built
    Then the agent is listed once
    And the listed row is the registered one

  @unit
  Scenario: An agent from a provider the page has no source for is left off
    Given a provider agent whose provider has no source chip
    When the agents list is built
    Then it is not listed
    And the provider is reported so somebody can add the chip
    # Never filed under Custom: that word means registered with LangWatch, and
    # borrowing it for "we could not tell" makes the source filter meaningless.

  @integration
  Scenario: An organization with no agents stays empty rather than filling with samples
    Given the reader has turned sample data off
    And the organization's agents read returns none
    When a governance viewer opens the Agents page
    Then no agent is listed
    And the page renders its own empty state

  @integration
  Scenario: A read still in flight shows neither agents nor an empty state
    Given the reader has turned sample data off
    And the organization's agents read has not answered yet
    When a governance viewer opens the Agents page
    Then the pane shows that it is still loading
    And it does not claim that no agent has registered

  @integration
  Scenario: A failed agents read says so instead of claiming there are no agents
    Given the reader has turned sample data off
    And the organization's agents read fails
    When a governance viewer opens the Agents page
    Then the page shows an alert saying the agents could not be loaded

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @integration
  Scenario: The empty agents page shows samples when requested
    Given no organization-wide agent read exists
    And the viewer has enabled sample data
    When a governance viewer opens the Agents page
    Then the sample agents are listed
    And each listed row says it is a sample
    And the banner says nothing on the page is real

  @integration
  Scenario: Turning sample data off leaves the honest empty pane
    Given the sample agents are on screen
    When the reader turns sample data off
    Then no agent remains listed
    And the pane renders the page's own empty state, headed
      "No agents registered yet"
    And that empty state offers a way to register one
    And the banner is gone

  # ---------------------------------------------------------------------------
  # Empty states. One shared shape (~/components/governance/empty), two
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
    Then the page renders an empty state with a glyph, a headline, a sentence
      and a button
    And it is not a bare sentence in a dashed box

  @integration
  # Title kept on one line: the parity checker's title group cannot cross a
  # newline, so a wrapped title binds a phantom that matches no scenario.
  Scenario: Filtering everything out offers the filters back, not a registration
    Given the sample agents are on screen
    When the reader picks a source and an ownership that no agent satisfies
    Then the pane says no agent matches these filters
    And the way out is clearing the filters, not registering an agent
    And clearing them brings the agents back

  @integration
  Scenario: The sample toggle and the register action sit in the page header
    When the Agents page renders
    Then both sit in the header row beside the page title
    And neither is offered anywhere else on the page

  # ===========================================================================
  # Registering an agent
  # ===========================================================================

  @integration
  Scenario: Register agent opens the connect-from-code drawer
    When the reader chooses Register agent
    Then the page asks for the register drawer rather than mounting one itself
    And the drawer explains that an agent registers itself from the process that runs it
    And it shows the Python and the TypeScript snippet that does it

  @integration
  Scenario: Registering an agent collects nothing, because nothing could be saved
    Given the register drawer is open
    Then it offers no field to fill in
    And it carries no submit, only the way out

  @integration
  Scenario: An address asking for the register drawer opens it on arrival
    When a governance viewer opens the Agents page with "add=1" in the address
    Then the page asks for the register drawer
    And closing it is a navigation, not local state

  @integration
  Scenario: The request to register an agent leaves the address once the drawer has it
    Given the address carries both "add=1" and the open register drawer
    Then the address no longer carries "add"
    And the drawer stays named in the address
    And the drawer is not asked for a second time

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
    Then no filter chip is inside the region holding the agents
    And with nothing registered the page offers no chips at all

  @integration
  Scenario: Filtering by source leaves only that source's agents
    Given sample agents from several sources
    When the reader picks a single source
    Then only that source's agents remain

  @integration
  Scenario: Ownership filters down to the agents nobody has claimed
    Given some sample agents carry an owner and some do not
    When the reader picks Unclaimed only
    Then only the agents with no owner remain
    And each of them carries the Unclaimed badge

  @integration
  Scenario: A filter choice is part of the address
    When the reader picks a source and an ownership and a sort order
    Then each choice is written to the address
    And opening that address again applies all three

  @integration
  Scenario: Sorting reorders the agents
    Given sample agents with different spend
    When the reader sorts by requests instead
    Then their order follows the request counts

  # ===========================================================================
  # The two layouts
  # ===========================================================================
  #
  # The list is what the page opens on, because the question it answers is a
  # comparison across agents and a card grid answers that a panel at a time.
  # The cards stay for reading one agent closely.
  #
  # THE LIST CARRIES EVERY ATTRIBUTE AN AGENT ROW HAS, which is ten columns.
  # Two of them — how the agent is doing and how long ago it registered — are
  # nowhere else on the page per agent: the card has no room for them and the
  # summary strip only counts them across the whole fleet. Surfacing those two
  # is a large part of what the list is for.
  #
  # Both layouts draw a figure through the same component, so a value the
  # platform does not have is the same em dash carrying the same sentence in
  # either one, and neither can quietly render a zero instead.

  @integration
  Scenario: The agents page opens on the list rather than the cards
    Given the sample agents are on screen
    When a governance viewer opens the Agents page
    Then the agents are listed one per row
    And no agent card is on screen
    And a layout switch offers List and Grid, with List chosen

  @integration
  Scenario: The list carries every attribute an agent row holds
    Given the sample agents are on screen
    When the list renders
    Then it has a column for the agent, its environment, its owner, its
      source, its models, its health, its spend, its request count, when it
      was last active and how long ago it registered
    And no column header is abbreviated

  @integration
  Scenario: Choosing Grid draws the cards and writes the choice to the address
    Given the sample agents are on screen
    When the reader chooses Grid
    Then the agent cards render instead of the list
    And the address carries "view=grid"
    And choosing List again takes it back out

  @integration
  Scenario: A value the list does not have reads as a dash, never a zero
    Given a sample agent that has never been called
    When its row renders
    Then its spend, its request count, its health and its last active read as
      a dash
    And each dash explains itself
    And the row still names the agent and the environment it runs in

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
  # First, every figure is derived from the same rows the agents below are
  # drawn from, in either layout. Nothing in the strip is a separately invented
  # number, so a reader who adds up what is listed gets the strip, and when an
  # organization-wide read lands and fills `GovernanceAgentRow` the strip
  # lights up from the same code path with no second set of figures to go and
  # change.
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
  Scenario: The fleet summary strip sits above the filter chips and the agents
    Given the sample agents are on screen
    When a governance viewer opens the Agents page
    Then a strip of four cards is above the agents
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
