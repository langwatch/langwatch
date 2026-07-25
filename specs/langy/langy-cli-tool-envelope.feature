Feature: Langy recognises its own CLI behind a shell tool call
  As a LangWatch user chatting with Langy
  I want a result Langy fetched with the LangWatch CLI to render as the card for that resource
  So that moving Langy from the MCP transport onto the CLI does not turn every answer back into a wall of console text

  # Langy runs on opencode, and opencode reaches LangWatch through the
  # `langwatch` CLI invoked in a shell. Every tool call therefore arrives named
  # `bash`, with the real intent buried in an opaque command string — where the
  # MCP transport used to say `platform_trace_search`, the shell says
  # `bash("langwatch trace search --format json | jq .")`.
  #
  # We own the CLI, and its grammar is stable: `langwatch <resource> <verb>`,
  # with `--format json` on every read. So the shell call is decoded back into a
  # typed capability BEFORE it is recorded: the tool name becomes
  # `langwatch.<resource>.<verb>` and the CLI's JSON document is lifted out of
  # the noisy stdout. Everything downstream — the durable event log, the live
  # stream, the capability cards — is keyed off that typed name and never has to
  # know a shell was involved.
  #
  # See specs/langy/langy-capability-cards.feature (what a card renders) and
  # specs/langy/langy-followup-suggestions.feature (what a result offers next).

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: A LangWatch CLI call is recognised whatever shell dressing surrounds it

    @unit
    Scenario: A plain CLI search is recognised as a trace search
      When Langy runs a shell command that searches traces with the LangWatch CLI
      Then the tool call is recorded as a trace search, not as a shell command

    @unit
    Scenario: A CLI call wrapped in a directory change is still recognised
      When Langy changes directory before running the LangWatch CLI
      Then the tool call is still recorded as the capability the CLI invoked

    @unit
    Scenario: A CLI call piped into another program is still recognised
      When Langy pipes the LangWatch CLI's output into another program
      Then the tool call is still recorded as the capability the CLI invoked

    @unit
    Scenario: A CLI call with environment variables in front is still recognised
      When Langy sets an environment variable before running the LangWatch CLI
      Then the tool call is still recorded as the capability the CLI invoked

    @unit
    Scenario: A shell command that is not a LangWatch CLI call is left alone
      When Langy runs a shell command that does not invoke the LangWatch CLI
      Then the tool call is recorded as a plain shell command
      And it renders as coding activity, not as a resource card

    @unit
    Scenario: A CLI invocation that names no resource and verb is left alone
      When Langy runs the LangWatch CLI with no resource and verb
      Then the tool call is recorded as a plain shell command

  Rule: The CLI's structured result reaches the card, not its console noise

    @unit
    Scenario: The JSON document is lifted out of a noisy stdout
      When the LangWatch CLI prints progress lines around its JSON result
      Then the recorded tool result is the JSON document alone

    @unit
    Scenario: Output with no JSON in it is recorded as it came
      When the LangWatch CLI prints only a human table
      Then the recorded tool result is the raw output, unchanged

    @unit
    Scenario: A failed CLI call keeps its error text
      When the LangWatch CLI exits with an error
      Then the recorded tool result keeps the error text the CLI printed

  # A failure the CLI described precisely — what went wrong, why, and what to do
  # about it — used to reach the panel as a bare sentence, because the envelope
  # kept only the message and threw the structure away. The card then had nothing
  # to show and printed "This step couldn't be completed", which tells the user
  # nothing at all.
  Rule: A failure keeps its structure all the way to the card

    @unit
    Scenario: A failure the CLI reported keeps everything it reported
      When the LangWatch CLI reports a failure in its own result document
      Then the recorded tool result keeps what went wrong and what to do about it
      And it does not reduce the failure to a bare sentence

    @unit
    Scenario: A command that fails outright still keeps its explanation
      When the LangWatch CLI explains a failure and then exits with an error
      Then the recorded tool result keeps the explanation, not the summary line

    @unit
    Scenario: A failure with no explanation keeps the summary line
      When the LangWatch CLI fails without explaining itself
      Then the recorded tool result keeps the summary line the CLI printed

    @unit
    Scenario: A failure card says what went wrong in the user's terms
      When Langy's tool call fails because the caller's access does not cover the action
      Then the card says the access does not cover the action
      And the card names the missing access in plain words as a detail
      And the card offers the next step the platform recommends
      And the card never shows an internal permission name as its headline

    # The card draws its conclusions from what the failure IS, never from
    # matching the English it happens to be phrased in — that pins user copy to
    # a pattern and hides whoever dropped the structure.
    @unit
    Scenario: A failure with nothing to add still says something useful
      When Langy's tool call fails and the platform sent no explanation
      Then the card names what failed
      And it shows the text it was given rather than swallowing it
      And it does not claim a reason it was never given

  # The card that told a user their access didn't cover creating a scenario was
  # reading the HTTP status, not the failure. 403 is the platform's word for
  # "no", and it says no for several different reasons — the key lacks the
  # permission, the plan lacks the allowance, a guardrail blocked the content.
  # Only the first is about access.
  Rule: What a failure IS decides what the card says, never its HTTP status

    @unit
    Scenario: A refused permission reads as a permissions problem
      When Langy's tool call is refused because the caller's access does not cover it
      Then the card says the access does not cover the action

    @unit
    Scenario: A refusal on the same status for a different reason keeps its own words
      When Langy's tool call is refused on the same status for a reason that is not about access
      Then the card says what the platform said
      And it never describes it as a permissions problem

  # A failure the panel has no copy for used to render as "This step couldn't be
  # completed" — which tells the reader nothing and tells support less. The code
  # is the one string that can be searched, quoted in a support thread, or
  # pasted into an issue.
  Rule: A failure card always shows the platform's own code for the failure

    @unit
    Scenario: A failure the card has copy for still shows its code
      When Langy's tool call fails with a failure the panel knows how to explain
      Then the card explains it in the customer's words
      And it still shows the platform's code for it

    @unit
    Scenario: A failure the card has no copy for names itself
      When Langy's tool call fails with a kind of failure the panel has never seen
      Then the card shows what the platform said about it
      And it shows the platform's code for it

    @integration
    Scenario: The whole failure can be copied in one click
      When Langy's tool call fails
      Then the code is selectable on the card
      And one action copies the whole failure for a support thread

  # The user asked Langy to create a scenario on a free plan that already had
  # three. The card told them their access in the project didn't cover the
  # action, sending them to check permissions they had nothing wrong with.
  Rule: A plan limit is a decision, not a broken step

    @unit
    Scenario: A plan limit says what the plan includes and what is in use
      When Langy's tool call is refused because the plan's allowance is used up
      Then the card says how many the plan includes and how many are in use
      And it names what ran out in the customer's own words
      And it never shows the platform's internal name for the limit

    @integration
    Scenario: Someone who can change the plan is offered the upgrade
      Given I can change my organization's plan
      When Langy's tool call is refused because the plan's allowance is used up
      Then the card offers to upgrade as its one clear action
      And choosing it opens the plan page without reloading the app
      And a floating panel gets out of the way of the page it opens

    @integration
    Scenario: Someone who cannot change the plan is told who to ask
      Given I cannot change my organization's plan
      When Langy's tool call is refused because the plan's allowance is used up
      Then the card tells me to ask whoever manages the plan
      And it offers me no action I would be refused at

  # The agent retried a create that had been refused on a plan limit, with a
  # different set of flags. No argument change could ever have worked, and the
  # retry put a second card in the transcript for a resource that was never made.
  Rule: A failure says whether there is anything left to try

    @unit
    Scenario: A refusal is marked as terminal
      When the platform refuses a request in a way no different request could satisfy
      Then the failure document says so outright
      And the agent is told to report it rather than re-attempt it

    @unit
    Scenario: A transient failure is not marked terminal
      When a request fails because of rate limiting or an outage on our side
      Then the failure document does not call it terminal

  Rule: A recognised CLI call renders as the card for its resource

    @integration
    Scenario: A CLI trace search renders the traces card
      When Langy searches traces with the LangWatch CLI and it returns matching traces
      Then Langy shows a traces card listing the matched traces
      And each trace row links to that trace

    @integration
    Scenario: A CLI trace search that matched nothing renders an empty traces card
      When Langy searches traces with the LangWatch CLI and it returns none
      Then Langy shows a traces card saying no traces matched

    @unit
    Scenario: A CLI command with no card for it falls back to raw activity
      When Langy runs a LangWatch CLI command that has no card
      Then the tool call renders as activity with its raw payload inspectable
