Feature: Reading a trace the way the drawer reads it
  The trace drawer already knows how to turn stored payloads into something a
  person can read: a thread becomes a markdown conversation, an LLM span's
  messages get split between the input and output panels, and a whole trace
  becomes a digest. Everything else that needs the same text (an eval, an
  export, a query that projects a conversation) had no way to ask for it,
  because the rules lived inside React components.

  These scenarios cover the framework-free modules that hold those rules, so
  the drawer and the server produce the same text from the same trace, and so
  the text can be bounded before it is handed to a model.

  # =========================================================================
  # Parsing a thread's turns
  # =========================================================================

  @unit
  Scenario: A thread is parsed once for every reader
    Given a thread of turns carrying stored input and output payloads
    When the turns are parsed
    Then each turn carries the readable user text, assistant text and reasoning
    And each turn carries its input-side and output-side media separately
    And the first turn has no gap before it

  @unit
  Scenario: The wall-clock gap between turns is measured from the previous turn's end
    Given a turn that started well after the previous turn finished
    When the turns are parsed
    Then the gap is the seconds between the previous turn's end and this one's start
    And a gap short enough to read as the same exchange is not worth showing

  # =========================================================================
  # Rendering a conversation under a token budget
  # =========================================================================

  @unit
  Scenario: A conversation that fits the budget is rendered whole
    Given a parsed conversation
    When it is rendered with a budget it fits inside
    Then the whole conversation comes back
    And it is not reported as truncated

  @unit
  Scenario: A conversation over the budget keeps its head and tail and marks the cut
    Given a parsed conversation larger than the budget
    When it is rendered with that budget
    Then the conversation heading and its real turn count are kept
    And turns are kept from the start and from the end
    And more of the budget goes to the end than to the start
    And a visible marker names how many turns were left out
    And the result fits the budget

  @unit
  Scenario: A single turn larger than the whole budget is cut mid-turn
    Given a parsed conversation whose every turn is larger than the budget
    When it is rendered with that budget
    Then the result is cut to the budget
    And the final turn keeps its opening and its ending, so the last reply is still read
    And a visible marker says the text was truncated

  @unit
  Scenario: Conversation markdown chunks name the turn they belong to
    Given a parsed conversation of several turns
    When the markdown chunks are built
    Then every chunk of a turn names that turn's number
    And the conversation preamble names no turn

  # =========================================================================
  # Splitting a chat payload between input and output
  # =========================================================================

  @unit
  Scenario: The input side is the history without this turn's reply
    Given a chat payload ending in a run of assistant messages
    When it is split for the input side
    Then the trailing assistant run is dropped
    And every earlier message is kept, including prior assistant operations

  @unit
  Scenario: The output side starts at the last request the user made in words
    Given a chat payload whose last text-bearing user message is followed by tool calls and replies
    When it is split for the output side
    Then everything after that user message is kept in full
    And the tool calls and intermediate assistant messages are part of the response

  @unit
  Scenario: A payload with no text-bearing user message is returned whole
    Given a chat payload carrying only an assistant reply
    When it is split for the output side
    Then the whole payload comes back

  # =========================================================================
  # Choosing the LLM span that stands for a trace
  # =========================================================================

  @unit
  Scenario: The last LLM span whose input reads as a conversation wins
    Given a trace with several LLM spans
    When the span standing for the trace is chosen
    Then it is the last LLM span whose input reads as chat messages
    And an LLM span whose input is a bare string is skipped
    And a span that is not an LLM call is never chosen

  @unit
  Scenario: A trace with no chat-shaped LLM span falls back to its own text
    Given a trace whose spans carry no chat-shaped LLM input
    And the trace itself recorded a primary input and output
    When the trace's messages are read
    Then the trace's own input and output are returned as messages

  @unit
  Scenario: A trace with nothing to read returns nothing
    Given a trace with no chat-shaped LLM span and no primary input or output
    When the trace's messages are read
    Then no messages are returned

  # =========================================================================
  # Estimating and cutting text for a model
  # =========================================================================

  @unit
  Scenario: The token estimate counts bytes, not characters
    Given text that mixes ASCII with multi-byte characters
    When its tokens are estimated
    Then the estimate follows the UTF-8 byte length, not the character count
    And it agrees with the estimate the judge uses, so a digest that fits one fits the other

  @unit
  Scenario: A cut never leaves half a character behind
    Given text whose budget falls inside a multi-byte character
    When it is cut to the budget
    Then the cut moves back to the last whole character
    And a replacement character the text itself carried is kept

  @unit
  Scenario: A line-oriented digest is cut on a line break
    Given a digest whose lines each name something
    When it is cut to a budget that falls mid-line
    Then the cut moves back to the last whole line
    And a first line already over the budget is cut where the budget ends

  @unit
  Scenario: A text cut for a judge keeps its opening and its ending
    Given a text larger than the budget a judge can read
    When it is cut keeping both ends
    Then the result fits the budget
    And it starts with the text's opening and ends with the text's ending
    And a marker between them says how many tokens were left out
    And neither end is cut inside a multi-byte character

  # =========================================================================
  # Bounding the LLM-readable trace digest
  # =========================================================================

  @unit
  Scenario: A digest that fits the budget is returned in full
    Given a trace whose full digest fits the budget
    When the bounded digest is built
    Then the full digest is returned
    And it is not reported as truncated

  @unit
  Scenario: A digest over the budget becomes the structure plus the spans worth reading
    Given a trace whose full digest is larger than the budget
    When the bounded digest is built
    Then the span tree is returned
    And spans are expanded into it while the budget allows
    And a span that errored is expanded before a model call
    And a model call is expanded before a slower span of another kind
    And the result is reported as truncated

  @unit
  Scenario: A structure too large for the budget is cut
    Given a trace whose span tree alone is larger than the budget
    When the bounded digest is built
    Then the returned text fits the budget
    And it keeps the first and the last spans of the tree, on whole lines, with a marker between them
    And it is reported as truncated

  @unit
  Scenario: A bounded digest spends the caller's budget, not the judge tool's
    Given a long agent loop whose full digest is larger than an 8,000-token budget
    When the bounded digest is built for that budget
    Then spans are expanded past the 4,096-token limit of the scenario judge's expand tool
    And the text never tells the reader to call grep_trace or expand_trace
    And a span too large to expand whole is expanded keeping its opening and its ending

  # =========================================================================
  # What the judge renderings carry
  # =========================================================================

  @unit
  Scenario: An LLM span's messages include its system prompt
    Given an LLM span whose system prompt canonicalisation moved to gen_ai.system_instructions
    When the span's messages are read
    Then the input side starts with that system prompt as a system message
    And a span whose input already carries a system message is not given a second one

  @unit
  Scenario: An LLM span recorded in the OTel GenAI parts format reads as chat messages
    Given an LLM span whose messages carry parts instead of content
    When the span's messages are read
    Then each text part becomes the message content
    And tool call parts become tool calls and tool call responses become tool messages
    And the span can stand for its trace

  @unit
  Scenario: A conversation transcript renders the same on every day
    Given a thread rendered as a conversation transcript
    When it is rendered at two different times
    Then both renderings are identical
    And each turn heading carries the turn's absolute start time
