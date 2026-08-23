Feature: Prompt Playground conversation
  As a user iterating on a prompt in the playground
  I want the conversation to show everything the model and its tools did
  So that I can judge a prompt from the playground without opening the trace

  # Replaces the CopilotKit runtime and its chat UI. The playground now renders
  # through the shared conversation renderer that simulations and the Traces V2
  # drawer already use, and executes over a dedicated SSE endpoint instead of the
  # CopilotKit GraphQL runtime.
  #
  # Media part rendering itself is specified in specs/traces-v2/media-rendering.feature;
  # this file only pins that the playground reaches that renderer at all.

  Background:
    Given I am authenticated in project "my-project"
    And I have a prompt open in the playground

  # ── Rendering: what CopilotKit dropped ──────────────────────────────

  @integration
  Scenario: Tool calls from a loaded trace appear in the conversation
    Given the tab was opened from a trace whose assistant message made 2 tool calls
    When the playground renders the conversation
    Then both tool calls are shown with their names
    And each tool call shows a summary of its primary argument

  @integration
  Scenario: A tool call and its result read as one card
    Given the tab was opened from a trace containing a tool call and its matching result
    When the playground renders the conversation
    Then the call and its result are shown together under one tool name
    And the result body is hidden until the card is expanded

  @integration
  Scenario: A failed tool call is marked as failed
    Given the tab was opened from a trace containing a tool result flagged as an error
    When the playground renders the conversation
    Then that tool card is marked as failed
    And the surrounding conversation keeps its normal styling

  @integration
  Scenario: Assistant reasoning is shown above the reply
    Given the tab was opened from a trace whose assistant message carries reasoning content
    When the playground renders the conversation
    Then the reasoning is shown as its own block above the reply text

  @integration
  Scenario: A user turn renders markdown
    Given the conversation contains a user message with markdown emphasis
    When the playground renders the conversation
    Then the emphasis renders as formatting rather than literal asterisks

  @integration
  Scenario: An attachment in a loaded message is rendered
    Given the tab was opened from a trace whose message carries an audio attachment
    When the playground renders the conversation
    Then a media part is rendered for the attachment

  @integration
  Scenario: Each completed turn offers its trace
    Given a turn in the conversation has a trace that has landed
    When the playground renders the conversation
    Then that turn is separated by a labelled turn separator
    And the separator opens the trace when activated

  @integration
  Scenario: A turn whose trace has not landed yet offers no trace affordance
    Given a turn in the conversation has no trace stored yet
    When the playground renders the conversation
    Then the turn separator offers no trace affordance

  # ── Who is speaking ─────────────────────────────────────────────────
  #
  # The playground is the one conversation surface where the reader is one of
  # the two speakers and the other is the model they are iterating on, so the
  # generic "User" and "Assistant" name neither party.

  @unit
  Scenario: The two sides are named after the person and the model
    Given my profile carries my name
    And the prompt is set to run a model
    When the playground names the sides of the conversation
    Then my side is named with my first name
    And the replying side is named with the model, without its provider prefix

  @unit
  Scenario: A profile with no usable name leaves my side unnamed
    Given my profile carries only my email address in place of a name
    When the playground names the sides of the conversation
    Then my side is left unnamed
    And the replying side is still named with the model

  @integration
  Scenario: Named sides replace the generic message labels
    Given the playground has named the person and the model
    When the playground renders the conversation
    Then each message is labelled with the name of the side that sent it
    And neither generic role label is shown

  @integration
  Scenario: An unnamed side keeps its generic label
    Given the playground has named the model but not the person
    When the playground renders the conversation
    Then the replies are labelled with the model
    And my messages are still labelled "User"

  @integration
  Scenario: A simulation transcript keeps its own role labels
    Given a scenario run is rendered through the same conversation renderer
    When the transcript is rendered
    Then the simulated user and the agent under test keep their own labels

  # ── Execution transport ─────────────────────────────────────────────

  @integration
  Scenario: Sending a message streams the reply as it arrives
    When I send "summarise this" in the playground
    Then the assistant reply grows incrementally as content arrives
    And only the new content is appended for each update

  @integration
  Scenario: Structured output is shown as a tree once streaming finishes
    Given the prompt declares more than one output field
    When the execution completes
    Then the reply is rendered as a structured value rather than raw text

  @integration
  Scenario: A provider failure shows our copy, not the provider's sentence
    When the model provider rejects the request with a rate-limit error
    Then the conversation shows the rate-limit copy from the error registry
    And the provider's own message is not shown

  @integration
  Scenario: A configuration failure is reported in the conversation
    Given the prompt references a model that is not configured
    When I send a message in the playground
    Then the conversation shows the configuration failure
    And no partial assistant reply is left behind

  @integration
  Scenario: Stopping a running execution cancels it
    Given an execution is in progress
    When I stop the execution
    Then the run is cancelled
    And the partial reply that already arrived is kept

  # ── Access ──────────────────────────────────────────────────────────

  @integration
  Scenario: A viewer can run a prompt in the playground
    Given I hold only the permission to view prompts
    When I send a message in the playground
    Then the execution is accepted

  @integration
  Scenario: Execution is refused without permission to view prompts
    Given I hold no permission to view prompts
    When I send a message in the playground
    Then the execution is refused

  @integration
  Scenario: Execution does not accept a caller-supplied workflow
    When a caller posts an arbitrary workflow to the playground execution endpoint
    Then the request is rejected as malformed

  # ── Persistence ─────────────────────────────────────────────────────

  @integration
  Scenario: A refresh restores the conversation including the latest reply
    Given an execution has completed in the tab
    When I reload the browser
    Then the conversation still shows the latest assistant reply in full

  # ── What a reply shows ──────────────────────────────────────────────

  @unit
  Scenario: A reply's tool calls are shown whichever dialect the provider used
    Given two providers that report the same tool call in different dialects
    When I read either reply in the conversation
    Then I see the same tool call

  @unit
  Scenario: A reply mixing prose and a tool call shows both, in the order written
    Given a reply that explains itself and then calls a tool
    When I read it in the conversation
    Then I see the explanation and the tool call, in that order

  @unit
  Scenario: A spoken reply is shown once, with its transcript
    Given a reply carrying spoken audio and the transcript of that audio
    When I read it in the conversation
    Then I see one reply, with the transcript on it
    And the reply is not shown twice

  @unit
  Scenario: A message the model left empty shows nothing
    Given a message the model returned with no content
    When I read the conversation
    Then nothing is shown for it

  @unit
  Scenario: Messages belonging to one exchange are numbered as one turn
    Given two exchanges in the conversation
    When I read it
    Then each exchange is numbered once, in order

  # -- Binding the live turn to the input placeholder -------------------
  #
  # Three production regressions live in these rules. They were covered against
  # the CopilotKit adapter; the logic is now pure, so they are covered directly.

  @unit
  Scenario: The live turn binds to the input variable
    Given a saved prompt whose template references the input placeholder
    When I send a message in the playground
    Then the message is bound to the input variable

  @unit
  Scenario: A template that references the input absorbs the live turn
    Given a saved prompt whose user template is the input placeholder
    When I send a message in the playground
    Then the conversation sent to the model carries one user turn, not two

  @unit
  Scenario: Earlier turns survive the absorb
    Given a saved prompt whose user template is the input placeholder
    And the conversation already has an earlier question and reply
    When I send a new message
    Then the earlier turns are still sent
    And only the newest turn is absorbed

  @unit
  Scenario: The absorbed turn is sent as the newest turn
    Given a saved prompt whose user template is the input placeholder
    And the conversation already has earlier turns
    When I send a new message
    Then the template slot is the last message sent

  @unit
  Scenario: A reference in the system message also absorbs the live turn
    Given a saved prompt referencing the input placeholder only in its system message
    When I send a message in the playground
    Then the live turn is absorbed rather than duplicated

  @unit
  Scenario: A template with no input reference appends the live turn
    Given a saved prompt whose template never references the input placeholder
    When I send a message in the playground
    Then the live turn is appended after the template messages

  @unit
  Scenario: An explicit variable value beats the live turn
    Given the variables panel sets input to a non-empty value
    When I send a different message in the playground
    Then the panel value is used for the input variable

  @unit
  Scenario: An empty variable default falls back to the live turn
    Given the variables panel declares input with an empty default
    When I send a message in the playground
    Then the message is used for the input variable
