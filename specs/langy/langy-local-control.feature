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
      Then a user message reads that the local folder is connected, naming the folder and the machine
      And that message does not repeat the whole path the card already shows
      And Langy starts working on the change it offered

    @integration
    Scenario: The card reads connected within seconds of the terminal saying so
      Given an approved control request
      And no turn is in flight
      When the CLI connects
      Then the update signal makes the panel read the conversation's record again
      And the card reads connected without waiting for the next turn to end

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
    Scenario: A pause on the platform does not disconnect a live folder
      Given a connected folder running a command that takes minutes
      When LangWatch pauses for longer than the folder record lives
      Then the open connection writes the record back
      And the command's result is still delivered
      And the next call runs in the folder instead of asking for code access again

    @unit
    Scenario: A call written while the folder registers is handed over once
      Given a folder that has just registered
      And a call written between the subscription and the scan of pending calls
      When the connection is handed the call by both
      Then the command line receives it once
      And the id is forgotten when the result arrives

    @integration
    Scenario: Ctrl-C disconnects at once, not when a heartbeat expires
      Given a connected folder
      When the CLI exits
      Then the chip and the card read disconnected within a second
      And a call in flight fails with the folder offline

    @integration
    Scenario: The chat says the folder is gone
      Given a connected folder
      When the CLI exits
      Then the transcript carries a line that the folder is no longer connected
      And that line names the folder and the machine, the way the connect line does
      And it sits next to the line that said the folder connected
      And no new turn is started for it

    @unit
    Scenario: The line that says the folder is gone names the folder, not the path
      Given a folder shared from a deep path on my machine
      When the folder disconnects
      Then the line reads the folder name and the machine name
      And it reads the path only for a folder that has no name

    @unit
    Scenario: The disconnect notice does not put the conversation back to work
      Given a conversation with no turn in flight
      When the disconnect notice is written into the transcript
      Then the conversation stays idle
      And the panel starts no turn for the notice

    @integration
    Scenario: The disconnect notice reads as a notice, not as something I sent
      Given a transcript that carries the disconnect notice
      When the panel draws the conversation
      Then the notice reads as a plain line
      And it is not drawn as a message from me

    @unit
    Scenario: The card reads the connection off the record, not only off the stream
      Given the folder connected on a turn this browser never watched
      When the panel reads the conversation's record
      Then the card is told the folder is there and reads connected

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

    @unit
    Scenario: A command stopped at its time limit says the limit and how to raise it
      Given a connected folder
      When a command runs for longer than its time limit and is stopped
      Then the result says the command was stopped at that limit
      And it says the command can be asked for again with a longer time limit
      And it says the longest limit a command may ask for

    @integration
    Scenario: A long command keeps its turn alive
      Given a connected folder
      And Langy is running a command that takes several minutes
      When the command runs for longer than the turn stall window
      Then the turn is still in flight and its answer is not lost
      And the panel says what is running and on which machine

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

  Rule: The link the command line prints opens the conversation

    @unit
    Scenario: The follow-along link names the project the conversation belongs to
      When the platform builds the follow-along link
      Then the link points at the home page of that project
      And it carries the conversation parameter
      And it falls back to the site root when the project is not known

    @unit
    Scenario: The command line prints the follow-along link once
      Given the command line printed the follow-along link when the folder connected
      When Langy asks to run a command
      Then the terminal says to answer in the panel
      And it does not print the link again

    @unit
    Scenario: The follow-along link opens the panel on that conversation
      Given the command line printed a follow-along link for my conversation
      When I open that link
      Then the panel opens on that conversation
      And the address bar no longer carries the conversation parameter

    @unit
    Scenario: A link to a conversation I cannot see is refused silently
      Given a follow-along link for a conversation I have no access to
      When I open that link
      Then the panel does not switch conversation
      And the address bar no longer carries the conversation parameter

    @unit
    Scenario: The conversation parameter survives the home redirect
      Given a follow-along link, whose path is the site root
      When the root resolves my home page
      Then the conversation parameter travels to the page it lands on
