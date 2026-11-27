Feature: Langy turn facts for ops functions
  Langy answers staff ops functions (ADR-202) with ids, states, codes, counts and times read from its
  turn projection. Message text, commands, tool arguments, tool results and error text stay inside
  Langy.

  @unit
  Scenario: A stored failure collapses to its error code
    Given a failed turn whose stored error is a serialized handled error, a bare code or free text
    Then its failure code is the handled error's code, the bare code, or "other"

  @unit
  Scenario: A tool call is labelled by its tool and its LangWatch CLI group
    Given tool calls to "bash" running "langwatch trace search", to "bash" running "ls", and to a tool with an odd name
    Then they are labelled "langwatch.trace", "bash" and "other"
    And a CLI group outside the known groups reads "langwatch.other"

  @unit
  Scenario: A turn's model reads as a catalogue model or its provider's other
    Given turns that ran on "openai/gpt-5.4-mini", on "openai_codex/gpt-5.6-terra" and on a deployment a customer named under "azure"
    Then their models read "openai/gpt-5.4-mini", "openai_codex/gpt-5.6-terra" and "azure/other"
    And a name under no known provider reads "other" and no recorded model reads "unknown"

  @unit
  Scenario: A tool call's target is an id-shaped value of an id field
    Given a tool call whose input names a dashboard id, or whose command passes "--dashboard-id"
    Then its target kind is "dashboard" and its target id is that id
    And a value that is not id-shaped gives no target

  @unit
  Scenario: Turn facts of a conversation the project does not hold are refused as not found
    Given a project that holds no conversation "c1"
    When the turn facts of "c1" are read
    Then it is refused with "langy_conversation_not_found"

  @integration
  Scenario: Turn outcomes are counted per day, model, state and failure code over real Postgres
    Given Langy turns in two projects, one outside the requested projects, some failed and some with failed tool calls
    When the outcomes are counted for a window
    Then each group counts its turns, its distinct conversation owners and its failed tool calls by tool
    And turns outside the window or the projects are not counted

  @integration
  Scenario: One conversation's turn facts are read over real Postgres
    Given a Langy conversation with two turns
    When its turn facts are read
    Then each turn answers its state, failure code, times and tool calls in order
    And a conversation another project owns is not held by this one
