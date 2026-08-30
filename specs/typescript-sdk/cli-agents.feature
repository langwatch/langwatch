@unit
Feature: The agent commands show connected agents and run them through the relay
  As a developer who connected an agent from code
  I want the CLI to show where it runs and to send it one turn
  So that I can check the connection before I run a suite against it

  # A connected agent registers itself from code (connectAgent in TypeScript,
  # connect_agent in Python). The platform reports its environment, its
  # status, its instances, its owner and the parameters it declared, and the
  # relay route POST /api/agents/:id/call runs one turn on a live instance.
  # See dev/docs/adr/128-connected-agents.md.

  Rule: The list shows where each agent runs and whether it is online

    Scenario: The list prints Name, Environment, Status, Type, ID, Owner and Updated
      Given the project has a connected agent online in production and an HTTP agent
      When I run "langwatch agent list"
      Then the table has the columns Name, Environment, Status, Type, ID, Owner and Updated
      And the connected agent reads online
      And the HTTP agent has an empty environment and status

    Scenario: The status colour follows the status, not the column width
      Given a list with both an online and an offline agent
      When the status column is padded to the width of offline
      Then online is still green and offline is still grey

    Scenario: The owner column reads the owner of a personal agent or the host of a machine-scoped one
      Given a personal development agent owned by a user and a host-scoped one
      When I run "langwatch agent list"
      Then the first row names the user
      And the second row names the host label

  Rule: The detail shows the parameters an agent declared and its instances

    Scenario: The detail lists parameters with type, options, default and required
      Given a connected agent that declares model with options and plan with no default
      When I run "langwatch agent get <id>"
      Then the Parameters block reads model as a string, one of the options, with its default
      And plan as required

    Scenario: The detail lists the connected instances
      Given a connected agent with two instances
      When I run "langwatch agent get <id>"
      Then the Instances block counts two
      And each line reads the hostname, the label and when it connected

  Rule: A run of a connected agent goes through the relay

    Scenario: A message runs one turn on a live instance
      Given a connected agent that is online
      When I run "langwatch agent run <id> --message 'hi' --param model=gpt-5"
      Then the relay is called with one user message and the parameter
      And the output and the instance that answered are printed

    Scenario: An input body with messages is sent as the relay body
      When I run "langwatch agent run <id> --input '{"messages":[...],"threadId":"t1","session":{"id":"s1"}}'"
      Then the relay is called with those messages, the thread id and the session

    Scenario: A connected agent needs a conversation
      When I run "langwatch agent run <id> --input '{"question":"hi"}'"
      Then the command refuses and says to give --message or --input with messages

    Scenario: An offline connected agent is refused before the relay is called
      Given a connected agent that is offline
      When I run "langwatch agent run <id> --message 'hi'"
      Then the command says the agent is offline and to start the process that calls connectAgent

    Scenario: An HTTP agent is still called at its URL
      Given an HTTP agent
      When I run "langwatch agent run <id> --input '{...}'"
      Then the URL is called directly and the relay is not

  Rule: The help says which command serves which agent type

    Scenario: The dev command help points code agents to connectAgent
      When I read the help of "langwatch agent dev"
      Then it says the tunnel is for HTTP agents
      And it names connectAgent and connect_agent for agents written in code

    Scenario: The target help names the connected forms
      When I read the help of the --target flag
      Then it names connected:<id> and connected:<name>@<environment>
