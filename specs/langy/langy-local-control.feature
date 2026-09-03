Feature: Langy works in a folder shared from the developer's machine
  As a developer who shared my folder with Langy
  I want Langy to read, edit and run commands there as if it sat at my desk
  So that a change lands as a branch and a pull request from my own checkout

  # `langwatch langy --share-control` opens an outbound connection from the
  # developer's machine to LangWatch and executes the calls Langy makes with
  # its local tools. The transport follows the connected agents relay
  # (ADR-128): presence in Redis, calls dispatched through Redis so the
  # worker's request and the CLI's socket can land on different pods, and
  # long-poll routes for a network that blocks WebSockets.
  #
  # What the CLI allows to run is specs/langy/langy-local-permissions.feature.
  # What the developer sees in the terminal is
  # specs/typescript-sdk/cli-langy-share-control.feature.
  # See dev/docs/adr/129-langy-local-control.md.

  Background:
    Given I am signed in with Langy enabled for a project
    And a conversation where Langy asked for code access

  Rule: A control request binds one folder to one conversation

    @integration
    Scenario: Choosing the local folder records a request the CLI can find
      When I choose to share my local folder
      Then a control request exists for this conversation, my user and this project
      And the request expires in fifteen minutes
      And the CLI signed in as me lists it

    @unit
    Scenario: A new request replaces the conversation's older open request
      Given a control request I created
      When the same conversation asks for the folder again
      Then only the newest request is open
      And the CLI lists this conversation once

    @integration
    Scenario: Another user never sees my request
      Given a control request I created
      When a teammate lists their open requests
      Then my request is not among them
      And approving it with their session is refused

    @integration
    Scenario: Approving a request mints a session key for the conversation
      Given an open control request
      When the CLI approves it
      Then the CLI receives a Langy session key bound to the conversation
      And the key carries the permissions of a Langy session key and nothing more
      And the request is used up, so a second approval is refused

    @integration
    Scenario: An expired request is refused with the reason
      Given a control request older than fifteen minutes
      When the CLI approves it
      Then the approval is refused as expired
      And the card in the chat reads that the request expired and offers a new one

    @integration
    Scenario: Cancelling a request from the terminal closes the card
      Given an open control request
      When the CLI cancels it
      Then the card reads that sharing was cancelled
      And Langy's next turn offers the code access card again

  Rule: A connection is shown and starts the work

    @integration
    Scenario: A connected folder shows on the card and in the panel header
      Given an approved control request
      When the CLI connects
      Then the card reads the folder path, the machine name and the current branch
      And the panel header shows a chip with the folder name and a disconnect action

    @integration
    Scenario: Connecting starts the next turn on its own
      Given an approved control request
      And no turn is in flight
      When the CLI connects
      Then a user message reads that the local folder is connected, with the path and the branch
      And Langy starts working on the change it offered

    @integration
    Scenario: Connecting while a turn runs does not start a second turn
      Given an approved control request
      And a turn is in flight
      When the CLI connects
      Then the connection is recorded
      And no second turn is started
      And the running turn can use the folder from its next tool call

    @integration
    Scenario: The connection carries what Langy would otherwise probe
      When the CLI connects
      Then Langy learns the folder root, the git branch and remote, whether the tree is dirty, the operating system, the node and python versions, whether the GitHub CLI is signed in and the package manager
      And Langy does not spend a turn asking the folder for those

    @integration
    Scenario: The connection survives a network blip
      Given a connected folder
      When the socket drops and the CLI reconnects within a minute
      Then the folder reads connected throughout
      And a call made during the gap is delivered after the reconnect

    @integration
    Scenario: Ctrl-C disconnects at once, not when a heartbeat expires
      Given a connected folder
      When the CLI exits
      Then the chip and the card read disconnected within a second
      And a call in flight fails with the folder offline

    @integration
    Scenario: A folder not seen for thirty seconds reads offline
      Given a connected folder whose machine went to sleep
      When thirty seconds pass with no heartbeat
      Then the folder reads offline
      And Langy's next local call gets the offline pushback

  Rule: Local tools run on the developer's machine, never in the sandbox

    @unit
    Scenario: The worker carries one local tool for each built-in it mirrors
      When a worker is provisioned
      Then it has local tools for read, write, edit, bash, grep, find and ls
      And each takes the same parameters as the built-in it mirrors
      And each says in its description that it runs on the developer's machine

    @integration
    Scenario: A local call travels to the CLI and its result comes back
      Given a connected folder
      When Langy lists the files in the folder root
      Then the CLI executes the call in the folder
      And Langy receives the listing as the tool result
      And the panel shows the call as activity on my machine

    @integration
    Scenario: A call and its socket can be on different pods
      Given a connected folder whose socket is held by one app replica
      When the worker's call lands on another replica
      Then the call is still delivered
      And the result still reaches the worker

    @integration
    Scenario: Command output is capped and the rest is on disk
      Given a connected folder
      When Langy runs a command whose output exceeds the cap
      Then Langy receives the first part of the output and a note with the log path
      And the full output is in the log file in the folder's LangWatch directory

    @integration
    Scenario: A background command returns at once with its process and log
      Given a connected folder
      When Langy starts the development server in the background
      Then Langy receives the process id and the log path at once
      And the server keeps running after the tool returns

    @integration
    Scenario: Stopping the turn cancels the command on the machine
      Given a connected folder
      And Langy is running a long command
      When I stop the turn
      Then the CLI kills the command and its child processes
      And the tool result reads cancelled

    @integration
    Scenario: A local call without a folder gets a pushback, not an error
      Given no folder is connected to the conversation
      When Langy makes a local call
      Then the tool result says no folder is connected and names the code access step
      And Langy asks for code access instead of retrying

    @integration
    Scenario: The live stream stays alive during a long wait
      Given a connected folder
      When a local call waits more than three minutes for an answer
      Then the turn's live stream is still readable
      And a page reload shows the turn in flight with the waiting card

  Rule: The session key is the only credential and it ends with the conversation

    @integration
    Scenario: The CLI connects with the session key alone
      Given an approved control request
      When the CLI connects with an API key that is not the minted session key
      Then the connection is refused
      And the refusal names the reason

    @integration
    Scenario: Disconnecting from the panel revokes the key
      Given a connected folder
      When I disconnect from the panel header chip
      Then the CLI exits with a message that the folder was disconnected from LangWatch
      And the session key no longer connects
