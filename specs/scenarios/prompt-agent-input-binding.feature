Feature: Prompt agent input binding under simulation
  As someone simulating a prompt agent,
  I want the prompt to receive the variables it declares and the conversation it is discussing,
  so that the agent answers the customer instead of describing the payload it was handed.

  # Background (#6590, #6594)
  #
  # A prompt agent under simulation was rendered against a context holding
  # exactly two names, `input` and `messages`. Its own declared inputs were
  # never bound, so they rendered as empty strings, and `messages` was a raw
  # JSON.stringify of the conversation — including the `id` and `traceId` the
  # scenario runner stamps on every message. The model was shown a serialised
  # payload with blank fields and answered with one.
  #
  # An instrumented four-turn run against `main` (a09e7c72f) measured what
  # followed: when the model reproduced the payload it was shown, that reply
  # became the next turn's history and was serialised again, so turn N's
  # rendered prompt embedded turn N-1's verbatim and the request grew 319 →
  # 4630 bytes (×14.5). The same adapter over the same four turns with a model
  # that answered normally grew 319 → 1141 bytes with no embedding, so the
  # compounding is the re-serialisation meeting an echoed reply — not ordinary
  # conversation growth.
  #
  # Declared inputs bind through the same field-mapping machinery the code,
  # HTTP and workflow adapters already use.

  Background:
    Given a prompt is the agent under test in a simulation

  # --- Binding ---

  @unit
  Scenario: A declared input is bound by name to a scenario source
    Given the prompt declares inputs "question" and "thread_id"
    And no explicit mappings are configured
    When the template context is built for a turn
    Then "question" holds the latest user message
    And "thread_id" holds the conversation thread id

  @unit
  Scenario: An explicit mapping wins over the name match
    Given the prompt declares an input "question"
    And "question" is explicitly mapped to the static value "Use the knowledge base"
    When the template context is built for a turn
    Then "question" holds "Use the knowledge base"

  @unit
  Scenario: Explicit mappings do not unbind the inputs they leave out
    Given the prompt declares inputs "question" and "thread_id"
    And only "question" is explicitly mapped
    When the template context is built for a turn
    Then "thread_id" is still bound by name

  @unit
  Scenario: The base scenario names remain available to a template
    Given the prompt declares no inputs
    When the template context is built for a turn
    Then "input", "messages" and "threadId" are all bound

  # --- Unbindable inputs ---

  @unit
  Scenario: A prompt's only declared input receives the scenario message
    Given the prompt declares one input, named anything
    When the template context is built for a turn
    Then that input holds the latest user message

  @unit
  Scenario: An input nothing can be bound to renders as a visible placeholder
    Given the prompt declares inputs "question" and "customer_tier"
    And nothing in the simulation matches "customer_tier"
    When the template context is built for a turn
    Then "customer_tier" holds "[unbound input: customer_tier]"
    And the unbound inputs are reported as "customer_tier"

  @integration
  Scenario: An unbindable input is reported on the run
    Given the prompt declares an input "customer_tier" that cannot be bound
    When the agent takes a turn
    Then the run records that "customer_tier" was unbound
    And the value of no input is recorded

  # --- Internal fields ---

  @unit
  Scenario: Internal message fields never reach prompt text
    Given the conversation messages carry the runner's "id" and "traceId"
    When the template context is built for a turn
    Then neither "id" nor "traceId" appears in any bound value

  @unit
  Scenario: A mapping that resolves to the conversation is sanitised too
    Given the prompt declares an input "history" mapped to the conversation
    When the template context is built for a turn
    Then "history" contains the roles and contents and neither "id" nor "traceId"

  @unit
  Scenario: The conversation reaches prompt text as prose, not as JSON
    Given a conversation of a user turn and an assistant turn
    When the template context is built for a turn
    Then "messages" holds one "role: content" line per turn
    And "messages" is not a JSON array

  # --- Compounding ---

  # The payload is the serialised conversation. A model that reproduces what it
  # was shown will always put its last reply into the next turn's history — that
  # is the conversation, not a defect. What the adapter controls, and what made
  # the reported run compound, is whether the thing being reproduced is a JSON
  # array that gets re-serialised and re-escaped one level deeper every turn.

  @integration
  Scenario: Turn N's request does not embed turn N-1's rendered payload
    Given a prompt whose template reads the conversation history
    And a model that replies with whatever it was shown
    When the agent takes four turns
    Then no turn's request contains a serialised message array
    And no turn's request contains an escaped payload nested inside another

  # --- Conversation history placement ---

  @unit
  Scenario: A template that reads the conversation places it itself
    Given a system prompt containing "{{messages}}"
    When the request is built
    Then the conversation is not appended a second time

  @unit
  Scenario: The word 'messages' in prose does not suppress the conversation
    Given a system prompt using the word "messages" only in prose
    When the request is built
    Then the conversation is still sent to the model

  @unit
  Scenario: A quoted literal is not a reference to the conversation
    Given a system prompt containing the Liquid expression {{ "messages" }}
    When the request is built
    Then the conversation is still sent to the model

  @unit
  Scenario: A loop over the conversation counts as reading it
    Given a system prompt looping over "messages" in a Liquid tag
    When the request is built
    Then the conversation is not appended a second time
