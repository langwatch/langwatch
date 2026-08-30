@unit
Feature: Agent tools expose connected agents and run them through the relay
  As an AI coding agent that drives LangWatch through the MCP server
  I want the agent tools to show where an agent runs and to send it one turn
  So that I can check a connected agent before I run scenarios against it

  # A connected agent registers itself from code (connectAgent in TypeScript,
  # connect_agent in Python); platform_create_agent does not create one. The
  # platform reports its environment, status, instances, owner and parameters,
  # and POST /api/v1/agents/:id/call runs one turn on a live instance.
  # See dev/docs/adr/128-connected-agents.md.

  Rule: The listing and the detail expose the connected fields

    Scenario: The listing shows environment, status, instances and owner
      Given the project has a connected agent online with two instances
      When the agent calls platform_list_agents
      Then the entry reads the environment, the status online, the instance count and the owner

    Scenario: The detail shows the parameters and the instances
      Given a connected agent that declares model with options and plan with no default
      When the agent calls platform_get_agent
      Then the parameters read their type, options, default and required
      And each instance reads its hostname, label and connection time

    Scenario: A secret parameter is marked secret
      Given a connected agent that declares a secret parameter
      When the agent calls platform_get_agent
      Then the parameter line reads secret

    Scenario: The listing keeps the HTTP agent entry unchanged
      Given an HTTP agent
      When the agent calls platform_list_agents
      Then the entry reads name, id, type and updated only

  Rule: A run of a connected agent goes through the relay

    Scenario: A message runs one turn on a live instance
      Given a connected agent that is online
      When the agent calls platform_run_agent with a message and parameters
      Then the relay is called with one user message and the parameters
      And the response reads the output and the instance that answered

    Scenario: An input with messages is sent as the relay body
      When the agent calls platform_run_agent with an input that carries messages, threadId and session
      Then the relay is called with those messages, the thread id and the session

    Scenario: A connected agent needs a conversation
      When the agent calls platform_run_agent with an input that carries no messages and no message
      Then the tool says to give a message or an input with messages

    Scenario: A nested params object is refused before the relay
      When the agent calls platform_run_agent with an input whose params carry a nested object
      Then the tool says params takes a flat object of string, number or boolean values

    Scenario: An HTTP agent is still called at its URL
      Given an HTTP agent
      When the agent calls platform_run_agent
      Then the URL is called directly and the relay is not

  Rule: Run plans and test suites accept connected targets

    Scenario: A connected target names an agent by id
      When the agent calls platform_run_plan with a target of type connected and an agent id
      Then the run is scheduled against that target

    Scenario: A connected target names an agent by name and environment
      When the agent calls platform_run_test_suite with a target of type connected and referenceId support-agent@production
      Then the reference id is passed through for the platform to resolve
