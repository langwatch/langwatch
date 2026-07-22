Feature: Langy renders domain-capability cards for tool calls
  As a LangWatch user chatting with Langy
  I want each of Langy's tool calls to render as a purpose-built card for that capability
  So that I can read results in place, apply proposed changes deliberately, and jump to the right surface

  # Cards are keyed off the tool-call NAME in the assistant turn's tool parts.
  # Governing rule: propose-then-apply. Reads render results inline with no
  # Apply; writes are staged proposals (Apply / Discard); destructive actions
  # are confirm-gated in red; every card offers an "Open in <surface>" deep link.
  # Any tool with no mapping falls through to the existing raw-JSON fallback.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  @integration
  Scenario: A trace search renders results inline with no Apply
    When Langy runs the trace-search capability and it returns matching traces
    Then Langy shows a traces card listing the matched traces
    And each trace row links to that trace
    And the card offers an "Open in Traces" link
    And the card shows no Apply or Discard action

  @integration
  Scenario: A single trace lookup renders a span summary
    When Langy runs the single-trace capability for one trace
    Then Langy shows a trace card summarising that one trace
    And the card links to that trace

  @integration
  Scenario: An analytics query renders as a metrics card
    When Langy runs the analytics capability and it returns numbers
    Then Langy shows a metrics card with the reported figures
    And each figure rolls up from zero as a rolling number
    And the card offers an "Open in Analytics" link

  @integration
  Scenario: An evaluation run renders its result
    When Langy runs an experiment or suite and it completes
    Then Langy shows an evaluation-run card with the run outcome
    And the card links to the run

  @integration
  Scenario: Creating a resource renders as a proposal until I apply it
    Given Langy has staged a new evaluator as a proposal
    Then the card reads as a proposal with Apply and Discard actions
    And nothing is created until I choose Apply
    When I choose Apply
    Then the card flips to an applied state with an "Open evaluator" link

  @integration
  Scenario: A destructive action is gated behind a red confirm
    Given Langy has staged the deletion of an evaluator
    Then the card reads as destructive in red
    And the confirming action is labelled to make the deletion explicit
    And a Cancel action is offered alongside it

  @integration
  Scenario: A prompt update renders as a before-and-after diff
    When Langy proposes an update to a prompt
    Then the card shows the prompt change as a before-and-after comparison
    And I can apply or discard the change

  @integration
  Scenario: A dataset listing renders the records inline
    When Langy lists a dataset and it returns records
    Then Langy shows a dataset card summarising the records
    And the card offers an "Open in Datasets" link

  @integration
  Scenario: A scenario result renders as a scenario card
    When Langy runs or fetches a scenario simulation
    Then Langy shows a scenario card with the scenario outcome
    And the card links to Simulations

  @integration
  Scenario: Every LangWatch action Langy takes shows a result card
    When Langy runs any LangWatch action and it returns a result
    Then Langy shows a result card for that action
    And the card names the thing the action touched
    And it never falls back to a wall of raw output for a LangWatch action

  @integration
  Scenario: A LangWatch action the panel does not recognise yet still reads cleanly
    When Langy runs a LangWatch action the panel has never heard of
    Then Langy still shows a readable result card for it
    And the card is worded from the action's own name
    And the card offers no link rather than a broken one

  @integration
  Scenario: A prompt push renders what changed
    When Langy pushes a new version of a prompt
    Then Langy shows a card naming the prompt and its new version
    And the card lists what changed

  @integration
  Scenario: A run result rolls its numbers up
    When Langy runs an evaluation and the result reports counts
    Then Langy shows the counts as labelled figures
    And each figure rolls up from zero as a rolling number
    And the figures stay still for people who prefer reduced motion

  @integration
  Scenario: An unmapped tool falls through to the raw view
    When Langy runs a tool that is not a LangWatch action and has no capability card
    Then Langy shows the tool's raw name, state, input, and output
    And it does not fabricate a card it has no mapping for

  @integration
  Scenario: A capability tool still in flight reads as an activity line
    Given Langy has started a trace search that has not returned yet
    Then Langy shows a pending activity line for the search
    And the traces card only appears once the search returns

  @integration
  Scenario: Developer mode exposes the raw payload behind every card
    Given developer mode is on
    When Langy renders any capability card
    Then I can reveal the raw tool payload behind the card

  # Cards render from REFERENCES, not from a copy of the data. A result names
  # the things it touched (which traces, which dataset, how many in total);
  # the card fetches the current data for those things through the product
  # itself, as the person viewing it. The chat carries the pointer; the
  # product carries the truth.

  @integration
  Scenario: A card shows current data, fetched as the viewer
    When Langy searches traces and shows the results card
    Then the traces on the card are fetched fresh from the project
    And the card shows only what I am allowed to see
    And a teammate with different permissions sees only what they are allowed to see

  @integration
  Scenario: A result too large for the chat still renders correctly
    When Langy runs a search that matches far more than a chat message could carry
    Then the card still shows the correct total
    And a readable sample of the results
    And the way into the full result set

  @integration
  Scenario: Results start appearing while Langy is still working
    Given Langy has started a trace search that has not returned yet
    Then the in-progress card already shows traces matching the search
    And the card says Langy is still working
    And the settled card replaces the preview with the actual result

  @integration
  Scenario: A card holds its shape while its rows load
    When a results card is fetching its current data
    Then the card already shows the honest counts
    And placeholder rows hold the space the results will fill
    And the placeholders stay still for people who prefer reduced motion

  @integration
  Scenario: A deleted entity renders honestly
    Given Langy showed a card for results that have since been deleted
    When I look at that card again
    Then the card says those results are no longer available
    And it keeps the original counts
    And it keeps the way into the surface
    And it does not pretend the search matched nothing

  @integration
  Scenario: An aggregate re-runs its question
    When Langy answers with an analytics result
    Then reopening the conversation shows figures for the same question
    And the question the agent asked is preserved with the card

  @integration
  Scenario: An action the panel cannot fetch fresh still shows an honest summary
    When Langy runs a LangWatch action whose results the panel cannot look up
    Then the card renders the result as it was recorded
    And it never claims the data is current when it is not

  # A card must never manufacture a confident answer out of output it could not
  # read. Truncated or malformed tool output used to render "0 traces — No
  # traces matched", a definitive wrong claim.
  @integration
  Scenario: Unreadable tool output renders as unreadable, never as an empty result
    When Langy runs the trace-search capability and its output cannot be parsed
    Then the card says it could not read the result
    And it does not claim that zero traces matched
    And the card still offers the way into Traces

  @integration
  Scenario: A genuinely empty result still reads as a real answer
    When Langy runs the trace-search capability and it returns zero traces
    Then the card says no traces matched

  @integration
  Scenario: Any card that cannot read its result says so
    When Langy runs a LangWatch action and its result cannot be read
    Then the card says it could not read the result
    And it does not show made-up names or numbers
    And the card still offers the way into its surface when one exists

  # A create card is a CLAIM: "this exists now, here is the way to it". A result
  # that names nothing created cannot support that claim, and the link it offers
  # goes nowhere. This is the failure a plan limit produced — the create was
  # refused, the agent re-attempted it with different arguments, the second
  # attempt returned nothing at all, and the panel drew a card for it anyway.
  #
  # Owning the doubt in a card ("Couldn't confirm the scenario was created") was
  # the first fix and it was still wrong: it put a SECOND card next to the
  # failure card for the same operation, telling the same event again in weaker
  # words. If we are not sure something happened, we do not draw a card about it.
  # The call still appears in the turn's completed-steps receipt, and the failure
  # card says what actually happened.
  Rule: A write card never claims success on a result that names nothing

    @integration
    Scenario: A create whose result names nothing renders no card at all
      When Langy runs a create action and its result names nothing that was created
      Then no result card is shown for that action
      And nothing claims the resource was created
      And nothing links to a resource that was never made

    @integration
    Scenario: The step is still accounted for in the turn
      When Langy runs a create action and its result names nothing that was created
      Then the action still appears among the turn's completed steps

    @unit
    Scenario: An empty create result is not a created-resource card
      When the CLI result for a create names no resource
      Then reading it as a created-resource card fails
      And the recorded result marks the outcome as unconfirmed

    @unit
    Scenario: A create that names the resource is still a created-resource card
      When the CLI result for a create names the resource it created
      Then reading it as a created-resource card succeeds
      And the recorded result does not mark the outcome as unconfirmed

    @unit
    Scenario: A genuinely empty read still earns its card
      When Langy runs a read action and it genuinely matched nothing
      Then the card is still shown, because empty is a real answer

  # "Open in Scenarios" reloaded the whole product. A card's links are inside a
  # live conversation, and a real browser navigation takes the panel, the
  # conversation and any streaming turn with it.
  Rule: A card's links never reload the app

    @integration
    Scenario: Following a card's link keeps the conversation alive
      When I follow a link on a capability card to somewhere in LangWatch
      Then the app takes me there without reloading
      And the Langy panel and my conversation are still there

    @integration
    Scenario: A card's links behave like links
      When I command-click or middle-click a link on a capability card
      Then it opens the way the browser would open any link
      And I can still copy its address from the context menu

    @integration
    Scenario: A link out of LangWatch is left alone
      When a card links somewhere outside LangWatch
      Then following it behaves as leaving the app, as it should

  # A turn is a sequence of events, and the panel has to read like one. The
  # transcript grouped its blocks by KIND — every failure, then the running
  # steps, then the completed-steps receipt, then the result cards — so a
  # failure on the last call of a turn drew above the summary of the three calls
  # that ran before it, and the panel said the turn broke before it said
  # anything had happened.
  Rule: The transcript reads in the order the turn happened

    @integration
    Scenario: A failure appears where it happened
      Given Langy ran two steps successfully and the third one failed
      Then the failure is shown after the summary of the steps that preceded it

    @integration
    Scenario: A turn that failed immediately still leads with the failure
      Given the first thing Langy did in a turn failed
      Then the failure is the first thing in the transcript

  # The scenario library lives under Simulations, and a scenario's own page is
  # the library with that scenario open. Pointing at the Simulations index sent
  # the user to the run history instead, where the scenario they just made is
  # nowhere to be seen.
  Rule: A scenario card links to the scenario, not to the run history

    @unit
    Scenario: A scenario card links to the scenario library
      When Langy shows a card for a scenario
      Then the card's surface link opens the scenario library

    @unit
    Scenario: A scenario card with an id opens that scenario
      When Langy shows a card for one named scenario
      Then the card's link opens that scenario in the library

  # WHICH card a result renders in is decided once, at the command boundary,
  # from the command's name and the result's own shape together (ADR-059). The
  # panel then re-derived the card from the NAME alone and dropped any result
  # whose card disagreed — so a result that had earned a RICHER card was the one
  # case guaranteed to disagree, and shape-driven promotion could only ever make
  # a card vanish, never improve one. The chart below is what that cost: the
  # card, the shape mapper and the plot all existed and none of them ever drew.
  Rule: The card a result was stamped with is the card that renders

    @integration
    Scenario: A cost question over time renders as a chart
      When Langy asks the platform for cost over the last week
      Then Langy shows the trend as a plot rather than as a single figure
      And the plot names the period it compares against

    @integration
    Scenario: A result that earned a richer card than its name implies still renders
      When Langy runs a LangWatch action whose result was recorded as a richer card
      Then Langy shows that richer card
      And the result does not disappear from the conversation

    @integration
    Scenario: A result that earned nothing richer keeps the card its name gave it
      When Langy lists a resource whose result carries neither a trend nor a total
      Then Langy shows the same result card it has always shown
