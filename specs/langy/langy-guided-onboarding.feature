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
      And the reveal id, the name and the preview come from the brief's Virtual key line

    # The brief carried the reveal id, yet the skill's prose let the "key
    # exists" branch read as the first match: a list showed the row, the
    # question was asked, a second key was minted and the tour's key was
    # left behind. The cases are numbered, the reveal in hand is case one,
    # and case one ends the path before any list, question or mint.
    @unit
    Scenario: The reveal id in the brief is used before any list, question or mint
      Given the brief's Virtual key line carries a name, a preview and a reveal id
      When the compiled guided-onboarding skill is read
      Then the gateway path's cases are numbered and checked in order, the reveal in hand first
      And case one says the live line and shows the card with the brief's reveal id, with no list, no question and no mint
      And the list, the question and the create all come after case one
      And no section title reads as "the key exists" alone

    # The endings pointed at a shared "Close the path" subsection, and on the
    # mint path the jump was dropped: the card was shown, complete-path ran,
    # and the closing line was never said. A line in front of the model is
    # followed; a pointer is not, so each ending carries the close itself.
    @unit
    Scenario: Every gateway ending says the closing line after the card, inline
      When the compiled guided-onboarding skill is read
      Then the gateway section has no shared close subsection to jump to
      And the ending that shows the card runs complete-path right after it, then says the closing line as the last line
      And the ending that asked first runs complete-path after either answer, then says the closing line as the last line

    # A snippet with a placeholder where the key goes is one the person cannot
    # paste, and a value in angle brackets reads as the key itself to someone
    # skimming. When the key exists but its secret cannot be shown again, the
    # person decides: a new key through the card, or the lines with the key
    # described in words.
    @unit
    Scenario: A key that exists with no reveal gets a question, never a placeholder
      Given a production-app key exists and the brief carries no reveal id for it
      When the compiled guided-onboarding skill is read
      Then Langy says the key was created earlier and its secret was shown once, at creation
      And asks with a question card whether to create a new key, with "Create a new key" and "I saved it"
      And on "Create a new key" it mints with --reveal-once and shows the snippet through the secret snippet card
      And on "I saved it" it prints the two export lines with the address filled in and the key line described in words
      And the skill never writes a value in angle brackets where the key or the gateway address goes

    # The secret was pasted into a chat code block, and from there it was in
    # the conversation store, the projection and every viewer's history. The
    # key is minted with --reveal-once, so the CLI output carries a reveal id
    # and never the secret, and the secret_snippet card is what shows it,
    # once. See specs/langy/langy-secret-snippet.feature.
    @unit
    Scenario: The gateway snippet is shown through the secret snippet card, never printed
      When the compiled guided-onboarding skill is read
      Then the key is minted with --reveal-once
      And the snippet is shown by calling secret_snippet with the reveal id, the preview and a template carrying the secret placeholder
      And the card call comes right after the live line
      And the skill never writes a value starting with vk-lw- in a message

    @unit
    Scenario: The brief names the key the tour minted, by its reveal id
      When the panel builds the kickoff brief after the gateway tour minted a key
      Then the brief carries the key's name, its preview and its reveal id on one line
      And that line says to show it with secret_snippet using this reveal id, and not to list, ask or create keys
      And the brief never carries the secret
      And a brief for a tour that minted no key says so

    # The skill's prose put the reveal case first and a model still ran the
    # list, asked and minted over a reveal it held. The instruction now rides
    # on the brief line itself, next to the reveal id, and the skill's case
    # one repeats it word for word: the one place both read is the line.
    @unit
    Scenario: The settled Virtual key line tells Langy what to do with the reveal
      Given the stored guided state holds the tour's key with its reveal id
      When the kickoff is settled on the server
      Then the Virtual key line names the key as live with its preview and reveal id
      And says to show it with secret_snippet using this reveal id, and not to list, ask or create keys
      And a state that holds no key settles to "Virtual key: none minted by the tour" with no instruction

    @unit
    Scenario: The skill's case one repeats the brief's Virtual key instruction word for word
      When the compiled guided-onboarding skill is read
      Then case one of the gateway path quotes the brief's Virtual key line and says to do exactly that
      And says the list command is never run while the brief names a reveal id
      And the list command appears only under the case with no reveal id in the brief
      And no sentence in the skill says to check the keys first without that condition

    # The panel composes the kickoff from the guided state it holds, and the
    # drawer records the key the tour minted seconds before the tour ends: a
    # kickoff composed from a snapshot taken before that write said no key
    # was minted, and Langy wrote the snippet with a placeholder. The lines
    # the state settles (the picks, the provider, the gateway, the key) are
    # rebuilt on the server from the state as stored when the turn starts,
    # so the snapshot the panel held no longer matters.
    @unit
    Scenario: The brief's state lines are settled on the server from the stored guided state
      Given the panel composed the kickoff before the tour's key was recorded on the guided state
      When the kickoff turn starts
      Then the recorded kickoff carries the key's name, its preview and its reveal id
      And the model reads the settled brief, not the panel's snapshot
      And the picks, the provider and the gateway come from the stored state as well
      And what only the panel knows, the name, the first name and how the tour ended, stays as sent

    # The record was settled and the prompt was not: the worker's session
    # file for a live take on the settle showed the model reading "Virtual
    # key: none minted by the tour" while the stored message carried the
    # reveal id, and the model listed the keys as that line asks. The prompt
    # handed to the worker is composed from the settled message.
    @unit
    Scenario: The prompt the model reads is the settled brief, not the panel's snapshot
      Given the panel composed the kickoff before the tour's key was recorded on the guided state
      When the kickoff turn starts
      Then the prompt handed to the worker carries the settled Virtual key line with the reveal id
      And it never says none was minted

    # The suite composed its kickoff from the guided state after the key was
    # minted, so its brief carried the reveal id before it reached the server
    # and the settle was never exercised end to end. This case sends what the
    # panel sends live: a snapshot from before the key.
    @e2e
    Scenario: The suite sends the panel's snapshot from before the key and the server settles it
      Given the tour minted the production-app key
      And the kickoff is composed from a snapshot that predates the key, as the panel composes it live
      When the kickoff turn runs
      Then Langy shows the card from the reveal id on the guided state
      And Langy lists no keys and creates none

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
      And the opener is said first and the card is called right after it in the same step, never before the line

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

    # A film left the tracing edit uncommitted in the working tree: the branch
    # existed and its diff against main was empty. The commit is the first
    # thing after the agent reads online, not the last thing of the path.
    # No message of a film ever named the framework Langy found; the judge
    # reads the report, not the edits.
    @unit
    Scenario: Langy names the framework it found
      When the compiled guided-onboarding skill is read
      Then after reading the code Langy says one line naming the framework and the file it found it in
      And that line comes before the branch and the first edit

    @unit
    Scenario: The instrumentation is committed once the agent is online
      When the compiled guided-onboarding skill is read
      Then the tracing edit and the connect adapter are committed on the langy/ branch as soon as the agent is online
      And the commit stages the changed files by name, never the env file, with the message "Add LangWatch tracing and the connect endpoint" and no trailer
      And Langy keeps that branch checked out for the agent it started, and says so in one line

    # The pull request used to come at the very end of the path, after the
    # suite, so the person waited the whole path to see the change they could
    # already merge. It opens right after the commit now, and the address is
    # said in one sentence before the proposal; the card comes at the end.
    @unit
    Scenario: The pull request is opened before the proposal
      When the compiled guided-onboarding skill is read
      Then right after the tracing commit Langy pushes the branch and opens the pull request with the title "Add LangWatch tracing and the connect endpoint"
      And Langy says "I opened a pull request with the tracing change: {link}. You can merge it already." with the address the command printed in the braces
      And a missing remote or gh login is the one-line branch note instead
      And the proposal comes right after, in the same turn

    # A film said "All ready!" between the first run and the suite. The line
    # closes the path, so it waits for the suite run and its open run.
    @unit
    Scenario: The closing line waits for the suite run
      When the compiled guided-onboarding skill is read
      Then the closing line is said only once the suite ran and its run is open, and never before
      And a later file change is committed and pushed onto the same pull request

    @unit
    Scenario: The credentials are written after the tracing edit
      When the compiled guided-onboarding skill is read
      Then the credentials call comes after the tracing edit and before the agent starts
      And the key never reaches the model

  Rule: A step that fails stops the path

    # The wait is one CLI call, not a loop the model writes: a hand-written
    # poll once misread the list and gave up on an agent that was online.
    @unit
    Scenario: Nothing runs against an agent that is not online
      When the compiled guided-onboarding skill is read
      Then it waits for the agent row to read online through one agent list call that fails after two minutes
      And it never writes a loop of its own around the agent list
      And no scenario or suite runs against an agent that is not online

    # A film proposed the expired discount code as the first scenario, so the
    # first run failed by design and the two-things line had nothing to prove.
    @unit
    Scenario: The first scenario is the golden path
      When the compiled guided-onboarding skill is read
      Then the first scenario proposed is the agent's golden path, end to end, with inputs the code accepts
      And refusals, expired inputs and edge cases come in the suite after it

    # A film ended the turn on "Running it against your agent now." with no
    # run behind it: the line read as an answer and the developer waited.
    @unit
    Scenario: The running line and the run are one step
      When the compiled guided-onboarding skill is read
      Then the run command is called in the same step as the running line
      And the turn never ends on the running line

    # Every film so far dropped a different step of the back half: the run,
    # the suite, the closing line. The order is a list the model keeps in its
    # plan tool and reads before it ends a turn, not a sentence it remembers.
    @unit
    Scenario: The path is a checklist Langy keeps
      When the compiled guided-onboarding skill is read
      Then on the create option the fixed order goes into the plan tool as ten pending items, before any command
      And each item is marked done as it finishes
      And a turn never ends with an open item unless a command answered an error

    # A film said the no-pull-request line and ended the turn there: no closing
    # line, no complete-path. A missing remote is an item done, not a failure.
    @unit
    Scenario: A folder with no remote still completes the path
      When the compiled guided-onboarding skill is read
      Then a missing remote or gh login is one line saying the branch holds the commit and no pull request was opened
      And the step is done with that line, the proposal follows, and complete-path then the closing line close the path

    # A film said the chat line and added a sentence about the tracing edit in
    # the same turn, so the person's cursor never got the composer.
    # A run whose setup turn stopped at a failed key check got the person's
    # next message, read it as the agreed scenario, and created and ran it
    # with no question asked. The proposal is a plan decision: Langy proposes,
    # never acts unasked, whatever message arrives first.
    @unit
    Scenario: The proposal is the gate of step 4
      When the compiled guided-onboarding skill is read
      Then no scenario is created or run before the person has answered the proposal question
      And a message that arrives before the question, a scenario description included, finishes the setup and gets the question
      And a scenario described before the question becomes the title in it, with the answer still the person's

    # The key check was improvised twice because the model never loaded the
    # tracing skill that carries the command; the skills are loaded with the
    # skill tool and the command is in the guided skill too.
    @unit
    Scenario: The skills are loaded, not recalled
      When the compiled guided-onboarding skill is read
      Then the tracing and connect-agent skills are loaded with the skill tool before the first edit
      And the key check command is written in the skill, with -c and never a heredoc
      And a False answer is not a failed step: the load order is fixed and the same command runs again

    @unit
    Scenario: Chat about this ends the turn on the line alone
      When the compiled guided-onboarding skill is read
      Then the reply to "Chat about this" is the chat line itself, said in full, with nothing before or after it and no tool call
      And the turn ends after the line is said, never instead of it

    # A film ran seven docs lookups hunting for a connect-agent page that does
    # not exist, and the key check twice with two loaders.
    @unit
    Scenario: The connect endpoint comes from the connect-agent skill
      When the compiled guided-onboarding skill is read
      Then the connect call is written from the connect-agent skill and never searched for in the docs
      And the tracing step reads one framework docs page and no other
      And the key check runs once, with the tracing skill's one-liner for the language

    @unit
    Scenario: The path ends in a fixed order
      When the compiled guided-onboarding skill is read
      Then the commit, the push, the pull request and its sentence come before the proposal
      And the scenario is created and opened, the why-a-scenario line is said, the run happens
      And the two-things line, the suite, its run and the open run follow
      And complete-path runs before the closing line, which is last

    # The line is true whatever the verdict: the agent answered and the traces
    # flowed. Only a run that answers an error instead of a verdict skips it.
    @unit
    Scenario: A failed first run still gets the two-things line
      When the compiled guided-onboarding skill is read
      Then a run that answers a verdict, passed or failed, gets the two-things line
      And after a failed verdict the explanation comes first, then the line, then the suite

    @unit
    Scenario: A failed step stops with one line and no completion
      When the compiled guided-onboarding skill is read
      Then a step fails when a command answers an error, never when a judge answers a verdict
      And a run that answers an error instead of a verdict stops the path
      And Langy says in one line what is not done and what it needs, and ends the turn
      And neither the why-a-scenario line, the two-things line, the closing line nor complete-path follow

    # A film told the person the CLI was not logged into the project when the
    # agent process had died at import. The reason is what the process printed.
    @unit
    Scenario: An agent that never comes online is explained by its own output
      When the compiled guided-onboarding skill is read
      Then an agent that is not online after two minutes is explained by the last lines of its own log, the exception when there is one
      And never by a guess about the CLI, the login or the project

    @unit
    Scenario: LangWatch initialises after the project's environment is loaded
      When the compiled guided-onboarding skill is read
      Then the tracing edit keeps setup below the import that loads the env file
      And the key is checked visible to the process before the agent starts

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
      And the tour minted the virtual key production-app, with its reveal id in the brief
      When Langy starts
      Then Langy checks for an existing production-app key before minting one
      And no second key is minted
      And Langy says "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:"
      And Langy shows the environment snippet through the secret_snippet card, with the gateway base URL and the brief's reveal id
      And no message carries the secret
      And Langy says "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with."
      And the gateway path is recorded as complete

    @e2e
    Scenario: The gateway path mints the key when the tour did not
      Given the kickoff for the gateway path
      And no production-app key exists
      When Langy starts
      Then Langy mints the virtual key production-app with --reveal-once
      And Langy shows the environment snippet through the secret_snippet card, with the reveal id the create printed
      And no message carries the secret

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
      And Langy asks with a bare question whose own text reads "Now that your agent is integrated, I think we should write some tests for it: scenario tests prove your agent handles the conversations it exists for, and each run is traced so you see every step. The first one I'd write is Guest completes checkout, because it is the path most of your users take and it crosses the discount, payment and confirmation steps in one conversation."
      And that text is drawn as a reply paragraph above the options "Create "Guest completes checkout" as your first scenario test" and the quiet "Chat about this"
      And the framework line, the pull request line and the branch line are said with the say tool right before the card, in that order, with no reply text before it
      And no scenario exists yet

    @e2e
    Scenario: Chat about this hands the scenario back to the conversation
      Given Langy proposed the first scenario
      When I pick "Chat about this"
      Then Langy says "Of course. Tell me what the scenario should cover and I'll write it with you."
      And the composer takes the cursor
      And no scenario exists yet

    # Two films had the model call the question with no text and write the
    # step 2 lines with the rest of its reply, at the end of the turn, under
    # every card: a model that only writes text once its calls are done puts
    # any line asked for "above the call" after the answer instead. The lines
    # go through the say tool, one call each, right before the question, so
    # their place no longer depends on when the model writes. The answer is
    # followed by the checklist and the command, never a sentence. The tool
    # result itself carries the go as well (langy-choice-questions: "The tool
    # result carries the go").
    @unit
    Scenario: The step 2 lines are said before the card, and the answer is the go
      When the compiled guided-onboarding skill is read
      Then the framework line, the pull request line and the branch line are said with the say tool, one call each, right before the question is called, never in the reply text
      And on the create option the next thing is the checklist and the first command, with no sentence between the answer and them

    # The same films put the why-a-scenario line, the running line, the
    # two-things line and the closing line in that one block at the end. Every
    # scripted line goes through the say tool at its moment, and a turn whose
    # lines were all said that way ends with no reply text.
    @unit
    Scenario: Every scripted line is said with the say tool at its moment
      When the compiled guided-onboarding skill is read
      Then the openers, the fallback lines, the why-a-scenario line, the running line, the two-things line and the closers are each said with the say tool, at their moment
      And the closing line of every path is said after complete-path, with no reply text after it
      And the proposal stays the question field of the bare question

    # A take's suite came back failed on runs the agent had passed: the
    # criteria named tools ("calls place_order"), so the judge went to the
    # traces for proof and found none, and one situation said "a card that is
    # declined" without the number the code declines, so the simulated user
    # invented one the code accepted.
    # A run with a smaller model explored the empty sandbox, fetched one
    # integration docs page, reported the framework from that page and raised
    # the code access card again with the folder connected.
    @unit
    Scenario: Code access is asked once, and the framework line names a file that was read
      When the compiled guided-onboarding skill is read
      Then code_access is never called again while a folder is connected
      And the framework line names a file read with local_read, never a docs page

    @unit
    Scenario: The scenarios name outcomes and carry the inputs they hinge on
      When the compiled guided-onboarding skill is read
      Then the first scenario's criteria name what the person can see in the conversation, never the tool that produces it
      And every scenario of the suite carries in its situation the concrete input it hinges on, read from the code

    @e2e
    Scenario: Going ahead creates the scenario in the drawer beside the panel
      Given Langy proposed the first scenario
      When I pick "Create "Guest completes checkout" as your first scenario test"
      Then Langy creates the scenario, with no sentence between my answer and the creation
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
      And Langy points at the run to replay the conversation
      And Langy says "That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations."
      And Langy keeps the suite
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

    # A film said the two-things line and the closing line and never ran
    # complete-path: a tool call after a sentence that reads as the end is
    # what a model drops. So the call comes first, and the closing line is
    # what follows it, on every path.
    @e2e
    Scenario: Every path ends by recording its completion
      When Langy reaches the end of any path
      Then Langy runs "langwatch onboarding complete-path <path>" before the closing line
      And the closing line is the last thing said, right after the call returns
      And the organization's guided onboarding lists that path as done

  # ===========================================================================
  # The done marker: what complete-path shows in the panel
  # ===========================================================================

  Rule: The transcript tells the pull request once as words and once as a card

    # The step-by-step progress receipt (Clone, Branch, Commit, Push, PR) said
    # the same thing as the sentence with the link and as the card at the end,
    # three times on one screen.
    @integration
    Scenario: A guided conversation shows no progress card
      Given a guided conversation whose reply committed the tracing change
      When the reply renders
      Then no pull request progress receipt is drawn

    # The card is derived from the conversation's own tool calls: the branch
    # from the checkout, the title from the gh pr create flags, the address
    # from that command's stdout. With no remote it names the branch alone.
    @integration
    Scenario: The pull request card closes the path
      Given a guided conversation whose reply ran complete-path
      When the reply renders
      Then one pull request card sits after the closing line, with the title, the branch, the address and a button to open it
      And a reply that did not close the path draws no such card
      And with no pull request the card names the branch that holds the commit

    # "How did Langy do?" showed up between steps of the path, under a reply
    # that was not an answer yet.
    @unit
    Scenario: No feedback ask while the guided path runs
      Given a conversation that carries the kickoff
      Then the feedback ask is held while no reply since the kickoff ran complete-path
      And it may show once the path is closed, after the pull request card

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
