@unit
Feature: The agent commands show connected agents and run them through the relay
  As a developer who connected an agent from code
  I want the CLI to show where it runs and to send it one turn
  So that I can check the connection before I run a suite against it

  # A connected agent registers itself from code (connectAgent in TypeScript,
  # connect_agent in Python). The platform reports its environment, its
  # status, its instances, its owner and the parameters it declared, and the
  # relay route POST /api/v1/agents/:id/call runs one turn on a live instance.
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

    # A process that has just started takes a few seconds to register. The
    # wait lives in the command so no caller scripts a loop of its own around
    # it: Langy once wrote such a loop, misread the document it got back and
    # gave up on an agent that was online the whole time.
    Scenario: The list can wait for an agent to come online
      Given a connected agent that registers a few seconds after its process starts
      When I run "langwatch agent list --wait-online acme-checkout"
      Then the list is read again every few seconds until that agent reports online
      And the list is printed once it does
      And the command fails when the timeout passes with the agent still offline

    # Under --format json the spinner is silent, so the timeout used to leave
    # only the identity notice ("... Switch: langwatch login ...") and a gray
    # hint on stderr; a model read that as the command line asking for a
    # login, on a command line that was signed in.
    Scenario: The wait's timeout names the agent, the wait and the credentials, never a login
      Given a connected agent that never reports online
      When I run "langwatch agent list --wait-online acme-checkout --format json" and the timeout passes
      Then stderr says which agent it waited for, for how many seconds, and which credentials the listing was read with
      And the line is printed in every output format, not through the spinner
      And no line of the failure mentions a login command

    Scenario: A row the key cannot choose reads as not selectable
      Given a personal development agent owned by another person
      When I run "langwatch agent list"
      Then the row is listed
      And its owner cell is marked "owner only"

    Scenario: The detail says whether the key can choose the agent
      Given a personal development agent owned by another person
      When I run "langwatch agent get <id>"
      Then the detail names the owner
      And it says only its owner can run it

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

    Scenario: The tunnel command help points code agents to connectAgent
      When I read the help of "langwatch agent tunnel"
      Then it says the tunnel is for HTTP agents
      And it names connectAgent and connect_agent for agents written in code

    Scenario: The target help names the connected forms
      When I read the help of the --target flag
      Then it names connected:<name> first, as the agent in development
      And connected:<name>@<environment> and connected:<id> after it
