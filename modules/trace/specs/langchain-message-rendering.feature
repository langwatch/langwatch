Feature: LangChain serialised messages read as chat messages
  As a developer tracing a LangChain or LangGraph agent
  I want span inputs and outputs holding serialised LangChain messages to read as a conversation
  So that I do not have to decode raw LangChain JSON to see what my agent was sent

  The Python SDK and LangChain instrumentations record chain inputs and
  outputs with LangChain's own serialisation: `dumpd` constructor objects
  (`{"lc": 1, "type": "constructor", "id": [..., "HumanMessage"], "kwargs": {...}}`),
  `model_dump` dicts (`{"type": "human", "content": ...}`), `message_to_dict`
  dicts (`{"type": "human", "data": {...}}`), batched as `messages: [[...]]`,
  and LLM results as `generations: [[{"message": ...}]]`. Coercion happens
  when the payload is read, so traces stored before this change render too.

  Rule: LangChain messages coerce to chat messages

    @unit
    Scenario: A batch of dumpd constructor messages reads as a conversation
      Given a span input of `{"messages": [[...]]}` holding dumpd SystemMessage, HumanMessage, AIMessage, ToolMessage and AIMessageChunk objects
      When the payload is coerced to chat messages
      Then the messages read as system, user, assistant, tool and assistant in order
      And each message keeps its text content, string or content parts

    @unit
    Scenario: An AI message's tool calls read as OpenAI style tool calls
      Given a dumpd AIMessage carrying LangChain `tool_calls` with `name`, `args` and `id`
      When the payload is coerced to chat messages
      Then the assistant message carries a function tool call with the name, the id and the args as a JSON string
      And a ToolMessage answering it keeps its `tool_call_id` and `name`

    @unit
    Scenario: Tool calls only in additional_kwargs still read as tool calls
      Given a dumpd AIMessage with no `tool_calls` and OpenAI style `additional_kwargs.tool_calls`
      When the payload is coerced to chat messages
      Then the assistant message carries those tool calls

    @unit
    Scenario: model_dump and message_to_dict messages read as chat messages
      Given LangChain messages serialised with `model_dump` or `message_to_dict`
      When the payload is coerced to chat messages
      Then they read with the same roles as their dumpd form

    @unit
    Scenario: An LLM result's generations read as the assistant reply
      Given a span output of `{"generations": [[{"type": "ChatGeneration", "message": ...}]]}`
      When the payload is coerced to chat messages
      Then the generated message reads as an assistant message

    @unit
    Scenario: A typed chat_messages envelope holding LangChain messages reads as chat
      Given a `chat_messages` typed value whose items are dumpd LangChain messages
      When the payload is coerced to chat messages
      Then every item reads as a chat message with its role

    @unit
    Scenario: A dumpd object that is not a message is not read as chat
      Given a dumpd constructor object for a prompt template or a document
      When the payload is coerced to chat messages
      Then the payload is not chat-shaped and renders as JSON

  Rule: A trace's own input and output read as text, not LangChain JSON

    @unit
    Scenario: A span input of LangChain messages gives the trace the last user message as input
      Given the trace's topmost span input is a `{"messages": [[...]]}` batch of dumpd LangChain messages
      When the trace's input text is extracted
      Then it is the text of the last user message

    @unit
    Scenario: A span output of LangChain messages gives the trace the last assistant reply as output
      Given the trace's span output holds LangChain messages ending in an assistant reply after a tool call
      When the trace's output text is extracted
      Then it is the text of the last assistant message that carries text
