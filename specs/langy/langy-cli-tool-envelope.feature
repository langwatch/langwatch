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
