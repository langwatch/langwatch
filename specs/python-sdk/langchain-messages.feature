Feature: LangChain messages keep their roles in span inputs and outputs
  As a developer tracing a LangChain or LangGraph agent with the Python SDK
  I want the messages my chains receive and return to keep their roles
  So that the trace drawer shows them as a conversation instead of anonymous JSON

  @unit
  Scenario: A chain input holding LangChain messages keeps each message's role
    Given a chain receives `{"messages": [...]}` with system, human, AI and tool messages
    When the SDK serialises the chain input
    Then each message is a chat message with its role

  @unit
  Scenario: An AI message's tool calls and a tool message's call id are kept
    Given an AI message carrying tool calls and a tool message answering one
    When the SDK converts them to chat messages
    Then the AI message carries function tool calls with JSON arguments
    And the tool message has the tool role, its tool call id and its name
