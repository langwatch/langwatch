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
  # NOTHING IS MATCHED BETWEEN THEM. A registered agent and a provider agent
  # that share a name are two rows. The name is the only signal the two tables
  # share, and a merge resting on a string match with no other evidence risks
  # the worse of the two failures: a duplicate row is visible and a reader can
  # act on it, while a wrong merge removes an agent from the one page whose job
  # is to say what exists, and nobody can spot an absence. Over-counting is a
  # nuisance; under-counting is a lie. The People screen keeps two providers
  # naming one address as two rows for the same reason.
  # ===========================================================================

  @unit
  Scenario: The list holds the agents we registered and the agents we found
    Given the organization has registered a connected agent from code
    And a connected provider has named an agent of its own
    When the agents list is built
    Then both agents are listed
    And each says which of the two it came from

  @unit
  Scenario: The organization's agents read leaves out what does not belong on it
    When the organization's own agents are read
    Then only agents registered from code are read
    And an archived agent is left out
    And an agent nobody has seen for thirty days is left out
    And the hidden governance project's agents are left out
    # The five other agent kinds are optimization studio components, not
    # things that run against the organization on their own.

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
  Scenario: A shared name is not evidence that two agents are one
    Given a connected agent and a provider agent share a name
    When the agents list is built
    Then both are listed
    And each states its own origin
    And neither borrows the other's owner or environment

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

  # ===========================================================================
  # The sync control
  # ===========================================================================
  #
  # ASKING IS ASYNCHRONOUS, and every rule in this block follows from it. The
  # press dispatches a request on the `ingestion_pull` aggregate and returns.
  # The pipeline's outbox leases it, an effect handler calls the provider, and
  # an outcome event lands later. There is no completion to await, so the
  # control can only ever report what it STARTED. A press that resolved into
  # "found four agents" would be inventing the half that has not happened.
  #
  # A SECOND PRESS WHILE ONE IS RUNNING IS DROPPED, deliberately, not queued:
  # an admin pressing twice means "did that work", not "ask twice". The drop
  # happens inside the process manager where the page cannot see it, so the
  # page has to carry it in words. A live control that silently does nothing
  # reads as broken, so it goes quiet and says why.
  #
  # ONE ASK PER SOURCE, because the aggregate IS the source. Two sources are
  # two streams, two leases and two provider calls, and one refusing must be
  # recordable without losing the other's answer. Sources whose provider has
  # no agent listing at all are skipped before the ask rather than asked and
  # refused, since that refusal was knowable without spending a lease on it.
  #
  # EVERY UNPRESSABLE STATE CARRIES ITS OWN SENTENCE. Disabled with a reason
  # beats a press that does nothing, and it also beats an absent control: a
  # reader who cannot sync is the one least able to work out why the page will
  # not refresh. That is where this control departs from the people page's
  # `Run match pass`, which hides itself from a reader without the grant.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The sync control asks every provider that can list agents
    Given an organization with a Databricks source, a Copilot source and a
      source whose provider cannot list agents
    When a sync is requested
    Then a listing is requested from the Databricks and the Copilot source
    And the source whose provider cannot list agents is not asked at all
    And both asks are filed under the organization's governance project
    And both carry the same request id, because they are one press

  @unit
  Scenario: A source the scheduler will not pull is not asked, and is still on the screen
    Given an organization with a source whose provider can list agents
    And that source was never given a schedule to pull on
    When a sync is requested
    Then that source is not asked
    And the result does not count it among the providers it names
    But the screen still names it among the providers it speaks for
    # The last line is the guard, and it is here rather than in a scenario of
    # its own because alone it is a tautology — nothing filters that set
    # today, so it would pass unchanged. It only says something next to the
    # two above it: the obvious fix is to drop the source from the one set
    # the button and the screen both read, and that breaks the sentence
    # beside the button. An organization whose only listable source is
    # unscheduled would be told it has no provider that can list agents at
    # all, when it has one and has merely not scheduled it. Which sources
    # exist and which are worth spending an ask on are two questions, and the
    # schedule answers only the second.
    #
    # An ask lands on the source's own process, and a process that was never
    # given a working schedule stands down without recording anything — not
    # an answer, not a refusal, nothing the page can read afterwards. So the
    # press claimed it had asked, the page went on saying nothing was known
    # about that source, and no number of presses would ever change either.
    # Skipped for the same reason a provider that cannot list agents at all
    # is skipped: the outcome was knowable without spending a lease on it.

  @unit
  Scenario: A disabled source has no request sent for it either
    Given an organization with a source whose provider can list agents
    And that source has been disabled
    When a sync is requested
    Then no request is sent for that source
    And the result does not count it among the providers it names
    # Live or not is decided by the same rule the scheduler configures
    # processes from, imported here rather than written out again — two
    # copies is how the button and the scheduler come to disagree about which
    # sources exist. A disabled source is already turned away further down, at
    # its own process, which is why the claim is about the request and the
    # count rather than about the provider being called: what is saved here
    # is the lease and the number the press reports, not the call.

  @unit
  Scenario: The sync control reports what it started, not what it found
    Given an organization with two providers that can list agents
    When a sync is requested
    Then the result says how many providers were asked
    And it names them
    And it carries no count of agents found, because none has answered yet

  @unit
  Scenario: A sync that cannot be recorded says so instead of appearing to start
    Given an organization with a provider that can list agents
    And no governance project for the request to be filed under
    When a sync is requested
    Then the request is refused by name
    And nothing is dispatched

  @integration
  Scenario: A second press while a sync is in flight says so rather than doing nothing
    Given an administrator on the Agents page with a provider connected
    When they press the sync control
    Then the control goes quiet
    And it says a request was already made and reloading is how the result is seen
    And a second press dispatches nothing

  @integration
  Scenario: Sync with nothing scheduled says so and stays pressable
    Given an administrator on the Agents page with a provider connected
    And that provider is not scheduled to be asked
    When they press the sync control
    Then it says no connected provider is scheduled to be asked right now
    And it does not say that zero providers were asked
    And the control stays pressable
    # Nothing was requested, so nothing is remembered as requested: the
    # "already asked, reload to see" state is for a press that recorded an
    # ask, and going quiet over one that recorded none would leave the reader
    # waiting on an answer nobody was sent to fetch.

  @integration
  Scenario: An organization with no listing provider is told so
    Given an organization with no provider that can list agents
    When an administrator opens the Agents page
    Then the sync control is not pressable
    And it says no connected provider can list agents

  @integration
  Scenario: A reader who cannot sync is told why rather than shown nothing
    Given a reader without the governance manage grant
    When they open the Agents page
    Then the sync control is drawn and not pressable
    And it says only an administrator can ask a provider to list its agents

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
  #
  # THE PAGE CAN NAME ALL FOUR NOTHINGS NOW. A provider answering "this tenant
  # has no agents" and a provider refusing to answer are different facts, one
  # about the tenant and one about the credential, and they demand opposite
  # things of the reader: an empty tenant means nothing is wrong, a refusal
  # means somebody has to go and fix a permission or a credential. Showing one
  # sentence for both is what left an admin believing they had no agents while
  # a credential quietly failed.
  #
  # THE READ EXISTS. `syncSources` carries, per connected source, how the last
  # agents listing ended — narrowed on the server to the two things a person
  # does differently about a refusal: fix an access problem, or wait and ask
  # again. The HTTP status behind it does NOT come back. It is kept for an
  # operator reading a support ticket; a tenant admin shown "403" learns
  # nothing they can act on, and the branching that would need it happens
  # server-side in `ee/governance/services/pullers/`.
  #
  # WHICH NOTHING WINS. A refusal beats every other reading, even beside a
  # provider that answered cleanly — agents behind the refusing provider are
  # missing from the list, so any quieter pane would be overclaiming. Saying
  # the organization has no agents needs EVERY connected provider to have
  # answered; one answering "none" while another was never asked leaves the
  # weaker sentence, because the unasked one could be running a dozen.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An empty table with a provider connected says which and offers the ask
    Given an organization with providers that can list agents and no agents
    And no listing has been recorded for any of them
    When an administrator opens the Agents page
    Then the empty state names the connected providers
    And it says nothing has been listed from them yet
    And it does not claim the organization has no agents
    And the way out is asking them, not registering one from code

  @unit
  Scenario: The last listing outcome is read only from this organizations own records
    Given two organizations each with a connected provider
    When the page reads how the last listing of each ended
    Then it sees only the outcome recorded under its own organization

  @unit
  Scenario: A source nobody has asked reports nothing known rather than an answer
    Given a connected provider that has never been asked to list its agents
    When the page reads how its last listing ended
    Then it is told nothing is known, not that the provider holds none

  @integration
  Scenario: A provider that refused is never reported as an empty organization
    Given an organization with a provider that refused to list its agents
    When an administrator opens the Agents page
    Then the empty state says the provider refused
    And it does not say the organization has no agents
    And its words differ from the pane shown when a provider answered with none

  @integration
  Scenario: A refusal names which providers refused and what to do about it
    Given one provider refused for a credential problem and another answered
    When an administrator opens the Agents page
    Then the empty state names only the provider that refused
    And it says the page cannot say what that provider holds
    And it tells the administrator to check that connection

  @integration
  Scenario: A refusal that was only unreachable says to ask again
    Given an organization with a provider that could not be reached
    When an administrator opens the Agents page
    Then the empty state says to ask again rather than to check a permission

  # The server narrows every refusal to one of three things a person does
  # differently, and the page must speak for all three. A cause the page has
  # no words for used to fall into the "ask again" arm, which for a listing cut
  # short by our own page limit is the one thing not worth doing.
  @integration
  Scenario Outline: Every reason a provider refuses is named on the agents page
    Given an organization with a provider that refused because of <cause>
    When an administrator opens the Agents page
    Then the empty state says <advice>
    And it does not give another cause's advice

    Examples:
      | cause                          | advice                                        |
      | a credential or permission     | to check that connection's credentials        |
      | the provider not answering     | to ask again in a moment                      |
      | the list being cut short by us | that asking again will not help               |

  @integration
  Scenario: Two refusing providers show the advice that matters most
    Given two providers refused for different reasons
    When an administrator opens the Agents page
    Then the empty state names both providers
    And its advice is the one for the reason that most needs acting on
    # A fix outranks a wait, and a wait outranks a limit nobody here can
    # change. One pane carries one instruction, so it has to be the one the
    # reader would regret not seeing.

  @integration
  Scenario: A refusal never shows the HTTP status behind it
    Given an organization with a provider that refused to list its agents
    When an administrator opens the Agents page
    Then the empty state shows no status code and no provider error text

  @integration
  Scenario: A reader who cannot sync is told who can fix a refusal
    Given a reader without the governance manage grant
    And a provider that refused to list its agents
    When they open the Agents page
    Then the empty state says an administrator needs to check that connection
    And it does not tell them to ask again

  @integration
  Scenario: Every provider answering with none is the one time the page says so
    Given every connected provider was asked and holds no agents
    When an administrator opens the Agents page
    Then the empty state says the organization has no agents
    And the way out is registering one from code

  @integration
  Scenario: A provider answered and another unasked claims nothing about the tenant
    Given one provider answered with no agents and another was never asked
    When an administrator opens the Agents page
    Then the empty state says nothing has been listed from them yet
    And it does not claim the organization has no agents

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

  # The headline counts every agent and the line beneath it counts only the
  # dated ones, so on an organization with provider-found agents the two never
  # meet. Unsaid, that reads as a broken card and a reader cannot tell which
  # number to distrust. The caption states the gap so it becomes a fact.
  @unit
  Scenario: The fleet caption says which agents the line cannot include
    Given a fleet holding an agent with no registration date
    When the fleet summary is derived from it
    Then the caption says how many agents the line excludes and why
    And the sparkline's own description says the same
    And the caption stays quiet when every agent carries a registration date

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
