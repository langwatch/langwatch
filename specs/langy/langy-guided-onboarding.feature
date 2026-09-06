Feature: Langy guides the first setup after sign-up
  As someone who just signed up and picked what to set up
  I want Langy to take over from the tour inside its own panel
  So that my agent is traced and tested by the end of the conversation, not by the end of a docs page

  # The takeover screens and the coach-mark tour are deterministic app UI
  # (specs/features/onboarding/guided-welcome-takeover.feature and
  # specs/features/onboarding/guided-tour.feature). Langy becomes real when
  # the tour ends: the app sends a kickoff user message and Langy follows the
  # native-only `guided-onboarding` skill from there.
  #
  # The kickoff travels as an ordinary user message whose parts are
  # `[{ type: "guided-onboarding-kickoff", path, paths, provider, providerModel,
  # orgName, firstName, tourStatus }, { type: "text", text: <brief> }]`. Only
  # the text part reaches the model; the typed part is what the panel renders
  # as the tour card. There is no new server procedure: the message goes
  # through the same create and continue transport every message uses, and
  # `onboarding.attachConversation` records the conversation id.
  #
  # Every Langy line in this file is the prototype's, verbatim.
  #
  # Companion specs:
  #   - specs/langy/langy-choice-questions.feature (the choices card the options ride on)
  #   - specs/langy/langy-code-access.feature (how Langy reaches the code)
  #   - specs/langy/langy-agent-driven-navigation.feature (`langwatch navigate open`)
  #   - specs/features/onboarding/guided-onboarding-variant.feature (the durable state and the CLI)

  Background:
    Given an organization in the guided onboarding variant
    And the Langy panel is docked beside the page

  # ===========================================================================
  # The kickoff message and the tour card
  # ===========================================================================

  Rule: The kickoff is queued by the tour and sent by the panel

    @unit
    Scenario: Queuing the kickoff opens the panel on the path's conversation
      When the tour ends and the kickoff is queued for the llmops path
      Then the Langy panel is open
      And the kickoff waits for the panel with the path, the picks, the provider, the names and the tour status

    @unit
    Scenario: A queued kickoff for an attached conversation continues that conversation
      Given the organization already attached a conversation to its guided onboarding
      When the kickoff is queued for the gateway path
      Then the panel points at the attached conversation
      And the kickoff carries the visible text "Let's set up Gateway then."

    @unit
    Scenario: A queued kickoff with no attached conversation starts a fresh one
      When the kickoff is queued for the llmops path
      Then the panel points at no conversation
      And the kickoff carries no visible text of its own

    @unit
    Scenario: The kickoff message carries the typed part beside the model brief
      When the panel builds the kickoff message
      Then the first part is the guided onboarding kickoff part with the path, the picks, the provider, the names and the tour status
      And the second part is a text brief

    @unit
    Scenario: The brief tells the model everything the takeover collected
      When the panel builds the kickoff brief for the llmops path
      Then the brief names the path being set up
      And the brief lists every pick in the order they were made
      And the brief names the provider and the model
      And the brief names the organization and the person's first name
      And the brief says whether the tour was completed or skipped
      And the brief opens with the kickoff line and names no skill and no command

    # A value copied out of the brief must be the value alone. A sentence stop
    # after the gateway address was copied into the snippet with it.
    @unit
    Scenario: The brief's data lines end on their values
      When the panel builds the kickoff brief
      Then every line after the opener is a label, a colon and its value
      And no line ends with a sentence stop

    @unit
    Scenario: The brief names the instance's gateway
      When the panel builds the kickoff brief on an instance that serves a gateway
      Then the brief carries that gateway's address with its version path
      And on an instance without one the brief says none is configured
      And no brief names the hosted gateway by name

    @unit
    Scenario: The gateway snippet points at the instance's own gateway
      When the compiled guided-onboarding skill is read
      Then the snippet's base URL is the address after "Gateway:" in the brief, as it stands
      And the skill names no gateway host of its own

    @unit
    Scenario: A key the tour minted gets the live line, not an apology
      Given the tour already minted the production-app key
      When the compiled guided-onboarding skill is read
      Then the gateway path opens on the live line as if the key were just made
      And the snippet's secret placeholder reads as the one the dialog showed

    @unit
    Scenario: The panel sends the kickoff exactly once
      Given a queued kickoff
      When the panel is idle on the project
      Then the kickoff is consumed before it is sent
      And a second idle render sends nothing

    @unit
    Scenario: The panel attaches a fresh kickoff conversation to the organization
      Given a queued kickoff with no attached conversation
      When the transport answers with the new conversation id
      Then the organization's guided onboarding records that conversation id

  Rule: The model reads the brief, never the raw part

    @unit
    Scenario: The turn text of the kickoff message is the brief alone
      Given a user message whose parts are the kickoff part and the text brief
      When the turn service reads the message text for the model
      Then the text is the brief
      And nothing of the typed part reaches the model

    @unit
    Scenario: The worker recognises the kickoff brief by its opener
      Given a turn whose message opens with the kickoff line, on its own or after the continuation line
      When the Langy worker reads the turn
      Then it recognises the kickoff
      And a message that only quotes the kickoff line later, or in data folded ahead of it, is not one

    @unit
    Scenario: The worker places the skill ahead of the kickoff brief
      Given the guided-onboarding skill is installed in the worker
      When a kickoff turn reaches the worker
      Then the model reads the skill's whole script first and the brief last
      And an ordinary message gets no skill placed ahead of it

    @unit
    Scenario: A kickoff without the skill installed runs on the routing row alone
      Given the guided-onboarding skill is not installed in the worker
      When a kickoff turn reaches the worker
      Then the brief reaches the model as it was
      And the worker warns that the skill is missing

  Rule: The kickoff conversation is called Getting started, never after the brief

    @unit
    Scenario: The kickoff names its conversation Getting started
      Given a new conversation whose first user message is the kickoff
      When the conversation is created
      Then its title is "Getting started"
      And the brief shows as a title nowhere, not in the panel header, the history list or the follow-along link

    @unit
    Scenario: A title chosen at creation is never replaced by a generated one
      Given a conversation created with the title "Getting started"
      When its first successful reply arrives
      Then no title is generated for it
      And the title stays "Getting started"

    @unit
    Scenario: An ordinary first message still gets its placeholder title
      Given a new conversation whose first user message is typed text
      When the conversation is created
      Then its title is the placeholder derived from that text

  Rule: The kickoff renders as the tour card, never as a bubble

    @integration
    Scenario: A kickoff message renders as the tour card
      Given a conversation whose first user message carries the kickoff part
      When the conversation renders
      Then the message renders as the guided tour card
      And no user bubble shows the brief

    @integration
    Scenario: A reloaded conversation renders the same card
      Given a recorded kickoff message loaded from the conversation history
      When the conversation renders
      Then the message renders as the guided tour card
      And no user bubble shows the brief

    @integration
    Scenario: The card shows the tour in progress
      Given the guided tour is running
      When the tour card renders
      Then it reads "Doing guided tour" with a spinner
      And it cannot be expanded

    @integration
    Scenario: The panel shows the tour in progress before the kickoff exists
      Given the guided tour is running
      And the guided conversation does not exist yet
      When the panel renders
      Then it shows the tour card reading "Doing guided tour"
      And it does not show the empty state's invitation

    @integration
    Scenario: The tour card settles into the kickoff message without a flash
      Given the tour has just ended and the kickoff is queued
      When the kickoff message lands in the conversation
      Then the panel shows exactly one tour card
      And the empty state's invitation never showed in between

    @integration
    Scenario: The card settles once the tour is over
      Given the guided tour is not running
      When the tour card renders
      Then it reads "Guided tour" with a chevron

    @integration
    Scenario: Expanding the card shows what the takeover collected
      Given the guided tour is not running
      And the kickoff was for ACME, the picks Evals & LLM Ops and Governance, and the provider OpenAI with gpt-5
      When I expand the tour card
      Then it shows "Setting up for" ACME
      And it shows "You picked" "Evals & LLM Ops, Governance"
      And it shows "Provider" "OpenAI · gpt-5"
      And it shows a "Show me around again" button

    @integration
    Scenario: A kickoff without a provider shows no provider row
      Given the kickoff recorded no provider
      When I expand the tour card
      Then no "Provider" row is shown

    @integration
    Scenario: A kickoff without an organization name sets up for you
      Given the kickoff recorded no organization name
      When I expand the tour card
      Then it shows "Setting up for" "you"

    @integration
    Scenario: Clicking the row never replays the tour
      Given the guided tour is not running
      When I click the tour card row
      Then the card expands
      And the tour does not start again

    @integration
    Scenario: The button replays the tour and records the replay
      Given the guided tour is not running
      When I click "Show me around again"
      Then the tour starts again from its first step
      And the organization's guided onboarding records a replayed tour

  # ===========================================================================
  # Quiet options
  # ===========================================================================

  Rule: A quiet option is a real answer that reads as a link

    @unit
    Scenario: A question option marked quiet reaches the card
      Given the agent asks a question whose second option is marked quiet
      When the panel builds the choices card from the tool call
      Then the second option carries the quiet mark
      And the first option does not

    @integration
    Scenario: A quiet option renders as an underlined link
      Given an open choices card whose second option is quiet
      When the card renders
      Then the first option renders as a bordered row
      And the second option renders as an underlined link below it

    @integration
    Scenario: Picking a quiet option answers the question
      Given an open choices card whose second option is quiet
      When I pick the quiet option
      Then the selection carries that option's id
      And the card locks with that option marked

  Rule: The code access card offers a third, quiet way out when the skill asks for it

    @integration
    Scenario: The code access card shows the folder and GitHub actions
      When the code access card renders in the asking state
      Then the local folder action shows a folder icon
      And the GitHub action shows the GitHub mark

    @integration
    Scenario: The describe option shows only when the tool offered it
      Given a code access call whose input offers describing the agent instead
      When the code access card renders in the asking state
      Then a quiet "I'd rather describe it" link renders under the two actions

    @integration
    Scenario: A code access call without the offer shows no describe option
      Given a code access call whose input does not offer describing
      When the code access card renders in the asking state
      Then no "I'd rather describe it" link renders

    @integration
    Scenario: Picking describe answers as my own message
      Given a code access card offering the describe option
      When I pick "I'd rather describe it"
      Then my choice appears as my own message reading "I'd rather describe it"
      And no local folder is requested

    @unit
    Scenario: The tool reads the describe pick as words
      Given the user picked "I'd rather describe it" on the code access card
      When the next turn begins
      Then the model reads that the user would rather describe the agent

    # The prototype shows the opener and then the card. An ordinary code
    # access ask tells the model to say in one line what it will change; on
    # the guided kickoff the opener has already said it, and that line read as
    # a third sentence between the opener and the card.
    @unit
    Scenario: With the describe offer the turn ends on the card without a word
      Given a code access call whose input offers describing the agent instead
      When the tool shows the card
      Then it tells the model to end the turn without another word
      And it names the describe pick among the ways the next turn starts

    @unit
    Scenario: The opener is followed by the card and nothing else
      When the compiled guided-onboarding skill is read
      Then it says nothing goes between the opener and the code access card

  # ===========================================================================
  # The llmops path: the branch, the credentials, the order and the stops
  # ===========================================================================

  Rule: The brief is the script's only input

    @unit
    Scenario: The brief is the whole input
      When the compiled guided-onboarding skill is read
      Then it says never to run the onboarding state command during a guided path
      And a later kickoff carries its own brief

  Rule: The setup happens on Langy's branch with the project's own credentials

    @unit
    Scenario: The work happens on a Langy branch
      When the compiled guided-onboarding skill is read
      Then the edits go on a langy/ branch created from the default branch
      And never on the branch the user has checked out
      And the branch stays checked out while the agent Langy started runs on it

    @unit
    Scenario: The credentials are written after the tracing edit
      When the compiled guided-onboarding skill is read
      Then the credentials call comes after the tracing edit and before the agent starts
      And the key never reaches the model

  Rule: A step that fails stops the path

    @unit
    Scenario: Nothing runs against an agent that is not online
      When the compiled guided-onboarding skill is read
      Then it waits up to two minutes for the agent row to read online
      And no scenario or suite runs against an agent that is not online

    @unit
    Scenario: The path ends in a fixed order
      When the compiled guided-onboarding skill is read
      Then the scenario is created and opened, the why-a-scenario line is said, the run happens
      And the two-things line, the suite, its run, the open run, the commit and pull request follow
      And the closing line comes before complete-path, which is last

    @unit
    Scenario: A failed step stops with one line and no completion
      When the compiled guided-onboarding skill is read
      Then a run that answers an error instead of a verdict stops the path
      And Langy says in one line what is not done and what it needs, and ends the turn
      And neither the why-a-scenario line, the closing line nor complete-path follow

    @unit
    Scenario: The instrumentation that cannot be applied stops the path
      When the compiled guided-onboarding skill is read
      Then a refused key and a tracing edit that cannot be applied are among the stops
      And a refused key sends the user to the project's settings page for the variables

  # ===========================================================================
  # The skill and its routing
  # ===========================================================================

  Rule: The guided-onboarding skill ships with Langy only

    @unit
    Scenario: The skill is native-only and compiled
      When the native skill set is listed
      Then it contains guided-onboarding
      And the published skill set does not

    @unit
    Scenario: The skill carries every opener and closer verbatim
      When the compiled guided-onboarding skill is read
      Then it contains the llmops opener
      And it contains the describe fallback lines
      And it contains the why-a-scenario line
      And it contains the gateway, governance and coding scripts
      And it contains the skipped tour line
      And it contains the closing line

    @unit
    Scenario: The agent prompt routes the kickoff to the skill
      When the agent prompt is read
      Then its routing table sends a guided onboarding kickoff to guided-onboarding
      And the prompt fits its size budget

  # ===========================================================================
  # The conversation, per path (bound by the Langy scenario harness)
  # ===========================================================================

  Rule: Langy opens each path with its own words

    @e2e
    Scenario: The llmops path asks for code access first
      Given the kickoff for the llmops path
      When Langy starts
      Then Langy says "Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you."
      And the code access card offers "Share local folder" and "Connect to GitHub" and the quiet "I'd rather describe it"
      And the turn settles on the card

    @e2e
    Scenario: The gateway path prints the key and the snippet
      Given the kickoff for the gateway path
      And the tour minted the virtual key production-app
      When Langy starts
      Then Langy checks for an existing production-app key before minting one
      And no second key is minted
      And Langy says "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:"
      And Langy prints the environment snippet with the gateway base URL and the key
      And Langy says "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with."
      And the gateway path is recorded as complete

    @e2e
    Scenario: The gateway path mints the key when the tour did not
      Given the kickoff for the gateway path
      And no production-app key exists
      When Langy starts
      Then Langy mints the virtual key production-app
      And Langy prints the environment snippet with it

    @e2e
    Scenario: The governance path asks where to start
      Given the kickoff for the governance path
      When Langy starts
      Then Langy says "To govern anything I first need to see it. Your identity provider gives me people and teams, vendor billing exports give me the dollars, and each tool's admin API gives me seats and usage. Where should we start?"
      And the question offers "Connect identity provider" and "Connect a vendor billing export"
      When I pick one
      Then Langy opens the governance sources page
      And the governance path is recorded as complete

    @e2e
    Scenario: The coding path hands over the one command
      Given the kickoff for the coding path
      When Langy starts
      Then Langy says "You're a developer, so this one is easy. Run this in any repo where you use Claude Code:"
      And Langy prints "npx langwatch claude"
      And Langy says "Then I can show you around once your first traces are flying through."
      And the coding path is recorded as complete

    @e2e
    Scenario: A skipped tour gets the no-worries line
      Given the kickoff records that the tour was skipped
      When Langy starts
      Then Langy says "No worries! Everything the tour covers is in the menu on the left. I'll be right here when you need me."
      And Langy carries on with the path's own opener

  Rule: The llmops path reaches the code, proposes, and only then acts

    @e2e
    Scenario: The describe fallback still reaches the code
      Given the code access card is open on the llmops path
      When I pick "I'd rather describe it"
      Then Langy says "No problem. What does your agent do? One line is enough."
      When I describe the agent in one line
      Then Langy says "Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?"
      And the code access card offers the folder and GitHub actions again

    @e2e
    Scenario: Sharing the folder leads to a proposal, not a creation
      Given the code access card is open on the llmops path
      When I share the ACME checkout folder through share-control
      Then Langy detects LangGraph
      And Langy instruments tracing and the connect endpoint through the tracing, connect-agent and code-changes skills
      And Langy starts the agent
      And Langy asks "I read through the code. I think the first scenario we should write is Guest completes checkout, because it is the path most of your users take and it crosses the discount, payment and confirmation steps in one conversation. Can I create and run it for you?"
      And the question offers "Sure, go ahead!" and the quiet "Chat about this"
      And no scenario exists yet

    @e2e
    Scenario: Chat about this hands the scenario back to the conversation
      Given Langy proposed the first scenario
      When I pick "Chat about this"
      Then Langy says "Of course. Tell me what the scenario should cover and I'll write it with you."
      And the composer takes the cursor
      And no scenario exists yet

    @e2e
    Scenario: Going ahead creates the scenario in the drawer beside the panel
      Given Langy proposed the first scenario
      When I pick "Sure, go ahead!"
      Then Langy creates the scenario
      And the scenario editor drawer opens beside the docked panel with the draft in it
      And the panel stays open while the turn continues
      And Langy says "Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs."
      And Langy says "Running it against your agent now."
      And Langy runs the scenario against the connected agent

    @e2e
    Scenario: The first run proves testing and tracing, then the suite follows
      Given the first scenario passed
      Then Langy says "That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations."
      And Langy creates a suite with a few more scenarios
      And Langy runs the suite
      And Langy opens the run
      And Langy says "All ready! Let me know if there is anything I can help with."
      And the llmops path is recorded as complete

    @e2e
    Scenario: A scenario that fails keeps the suite
      Given the first scenario run failed
      When Langy reads the result
      Then Langy explains in plain words why the scenario did not pass
      And Langy keeps the suite and points at the run to replay the conversation
      And the llmops path is still recorded as complete

    @e2e
    Scenario: A folder that never connects gets the GitHub offer
      Given the code access card is waiting for the share-control command
      When the request expires with no folder connected
      Then Langy offers to connect to GitHub instead
      And nothing is created on the project

  Rule: The conversation stays in character

    @e2e
    Scenario: A typed message mid-setup keeps the tone
      Given Langy is in the middle of the llmops setup
      When I type an unrelated question
      Then Langy keeps the setup going in the same tone
      And Langy never drops the path it was on

    @e2e
    Scenario: The Home offer continues the same conversation
      Given the llmops path is complete in the attached conversation
      When I start the gateway path from the Home offer
      Then the attached conversation gets a new kickoff reading "Let's set up Gateway then."
      And the tour card for the gateway path renders in the same conversation
      And Langy opens the gateway path with its own opener

    @e2e
    Scenario: Every path ends by recording its completion
      When Langy reaches the end of any path
      Then Langy runs "langwatch onboarding complete-path <path>"
      And the organization's guided onboarding lists that path as done

  # ===========================================================================
  # The done marker: what complete-path shows in the panel
  # ===========================================================================

  Rule: The complete-path result renders as one line, the panel's done marker

    @integration
    Scenario: The done marker is one line
      Given Langy ran "langwatch onboarding complete-path coding" inside the panel
      When its card renders
      Then it reads "Coding Agent Tracking set up" and nothing else
      And no label and value rows are drawn

    @integration
    Scenario: The onboarding state card reads in customer copy
      Given Langy ran "langwatch onboarding state" inside the panel
      When its card renders
      Then the rows read the paths by their titles, the provider the vendor's way and the tour as Completed
