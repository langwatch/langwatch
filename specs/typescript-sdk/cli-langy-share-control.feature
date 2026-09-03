Feature: `langwatch langy --share-control` shares this folder with a Langy session
  As a developer at my own machine
  I want one command that gives the Langy conversation I am in control of this folder
  So that Langy makes the change here, with my toolchain, and I keep the last word

  # The CLI signs in with the device session, finds the control request the
  # conversation recorded, and asks me to approve in the terminal. From then
  # on it executes the calls Langy makes with its local tools and applies
  # the permission rules of specs/langy/langy-local-permissions.feature.
  # A bare `langwatch langy` does the same today. The tunnel of ADR-098 is
  # `langwatch agent tunnel`. See dev/docs/adr/129-langy-local-control.md.

  Rule: The request is approved in the terminal

    @unit
    Scenario: The command signs in when there is no session
      Given no device session on this machine
      When I run "langwatch langy --share-control"
      Then the CLI runs the login flow first
      And continues to the request list after the login

    @unit
    Scenario: An open request is shown with the conversation and the folder
      Given a Langy conversation recorded a control request for me
      When I run "langwatch langy --share-control" in my project folder
      Then the terminal reads the conversation title, the project and the folder it would share
      And offers Approve and Cancel

    @unit
    Scenario: Approving connects and prints where to follow along
      Given an open request shown in the terminal
      When I approve it
      Then the CLI connects the folder to the conversation
      And prints the link to the conversation
      And prints that permission questions appear in the panel

    @unit
    Scenario: Cancelling tells the conversation
      Given an open request shown in the terminal
      When I cancel it
      Then the request is cancelled on the platform
      And the CLI exits with code zero

    @unit
    Scenario: Several open requests become a picker
      Given two conversations recorded a control request for me
      When I run "langwatch langy --share-control"
      Then the terminal lists both with their titles and projects
      And each row says how long ago the conversation asked
      And I pick the one to approve

    @unit
    Scenario: One conversation is listed once
      Given one conversation recorded two control requests for me
      When I run "langwatch langy --share-control"
      Then the terminal lists that conversation once, with the newest request

    @unit
    Scenario: No open request waits for one
      Given no conversation recorded a control request for me
      When I run "langwatch langy --share-control"
      Then the terminal reads that it is waiting for a Langy conversation to ask for this folder
      And a request recorded later appears without restarting the command

    @unit
    Scenario: The folder is the current directory, reported as its real path
      Given I run the command from a directory reached through a symlink
      When the request is shown
      Then the folder reads the resolved path
      And that path is the boundary for every call

    @unit
    Scenario: The command refuses to share a home directory or a filesystem root
      When I run "langwatch langy --share-control" from my home directory
      Then the CLI refuses and says to run it from the project folder

    @unit
    Scenario: A folder that is not a git repository still works, with a note
      Given a directory with no git repository
      When I approve the request
      Then the CLI connects
      And the terminal notes that Langy cannot open a pull request from here

  Rule: The terminal shows what Langy does, one line per call

    @unit
    Scenario: Each call prints as one line
      Given a connected folder
      When Langy reads a file and runs a command
      Then the terminal prints one line per call with the tool and its target
      And command output is not echoed, only its exit status and size

    @unit
    Scenario: A permission request points at the panel
      Given a connected folder
      When Langy asks for permission to run a command
      Then the terminal prints the command and that the answer is given in the LangWatch panel
      And prints the outcome when the answer arrives

    @unit
    Scenario: Turning permission checks off is printed in red
      Given a connected folder
      When I turn permission checks off from the panel
      Then the terminal prints in red that permission checks are off for this session

    @unit
    Scenario: A disconnect from the panel ends the command
      Given a connected folder
      When the folder is disconnected from the panel
      Then the CLI prints that LangWatch disconnected the folder
      And exits with code zero

  Rule: Exiting is clean

    @unit
    Scenario: Ctrl-C tells the platform and stops running commands
      Given a connected folder with a command in flight
      When I press Ctrl-C
      Then the CLI tells the platform it is leaving
      And kills the command and its child processes
      And exits within five seconds

    @unit
    Scenario: A second Ctrl-C exits at once
      Given the CLI is shutting down
      When I press Ctrl-C again
      Then the CLI exits at once

    @unit
    Scenario: A background process Langy started outlives the command
      Given Langy started the development server in the background
      When the CLI exits
      Then the server keeps running
      And the terminal prints the process id and the log path so I can stop it

    @unit
    Scenario: The log directory is kept out of git
      Given a connected folder that is a git repository
      When the CLI writes its first log file
      Then the log directory is excluded from git through the repository's own exclude file

  Rule: The command is a live session, not a query

    @unit
    Scenario: JSON output is refused with the reason
      When I run "langwatch langy --share-control -o json"
      Then the CLI refuses and says the command is an interactive session

    @unit
    Scenario: The tunnel keeps its behaviour under its new name
      When I run "langwatch agent tunnel --port 8010"
      Then the tunnel session of the agent dev tunnel feature starts
      And "langwatch agent dev" does the same and is hidden from help
