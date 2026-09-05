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
      And prints that permission questions are answered here or on the card in LangWatch

    @unit
    Scenario: The request is asked in the same box as a permission question
      Given an open request shown in the terminal
      Then the box heading names the folder
      And the conversation title, the project and the folder read inside it
      And the first option shares the folder and is selected
      And the second option cancels the request
      When I confirm the first option
      Then the box is erased and one notice says the folder is shared

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

  Rule: The terminal reads like a coding transcript

    # One line per call with the tool name and its argument, and the result
    # under it behind a hook glyph. Command output is summarised rather than
    # echoed: the output belongs to Langy, and repeating all of it buries the
    # permission question and the disconnect.

    @unit
    Scenario: Each call prints as one line
      Given a connected folder
      When Langy reads a file and runs a command
      Then the terminal prints one line per call with the tool name and its argument
      And the result of each call is printed under it, indented
      And command output is not echoed in full, only its last lines

    @unit
    Scenario: A file call reports what it did, not what it read
      Given a connected folder
      When Langy reads a file and edits it
      Then the read prints the number of lines it read
      And the edit prints how many lines it added and removed
      And neither prints the content of the file

    @unit
    Scenario: A long command result keeps its last lines and counts the rest
      Given a connected folder
      When Langy runs a command that prints forty lines
      Then the terminal prints the last eight lines of the output
      And a dim line counting the lines it did not print

    @unit
    Scenario: A failed command prints its exit code
      Given a connected folder
      When a command Langy ran ends with a status
      Then the terminal prints the exit code in red under the call

    @unit
    Scenario: A background command prints its process and its log
      Given a connected folder
      When Langy starts a command in the background
      Then the terminal prints the process id and the log path under the call

    @unit
    Scenario: A refused call reads as a refusal
      Given a connected folder
      When the policy refuses a call
      Then the terminal prints the refusal in yellow under the call

    @unit
    Scenario: A running command says how long it has run
      Given a connected folder and a command that takes a while
      When the command is running
      Then the terminal draws a line under the call saying how long it has run
      And that line is replaced by the result when the command ends

    @unit
    Scenario: A question on the screen survives a command that finishes under it
      Given a permission question on the screen and a command still running
      When the command finishes under the question
      Then the question stays on the screen
      And the result of the command prints only after the question is answered

    @unit
    Scenario: A notice wraps on word boundaries at the terminal width
      Given a conversation title that is wider than the terminal
      When the terminal prints that the folder is connected
      Then every line breaks where the words end, with no word cut in half

    @unit
    Scenario: A result of a call that is not the last one repeats its call line
      Given two calls Langy made at the same time
      When the result of the first call arrives after the second call line
      Then the terminal prints the first call line again, dim
      And the result under that line

    @unit
    Scenario: A platform notice has no tool name
      Given a connected folder
      When LangWatch connects the folder or closes it
      Then the notice prints as a transcript line with no tool name

    @unit
    Scenario: The approval question wraps on word boundaries
      Given a request whose conversation title and folder are wider than the terminal
      When the terminal asks whether to share the folder
      Then the question is broken at the terminal width on spaces, with no word cut in half

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

  Rule: A permission question is answered in the terminal or on the card

    # The card in the LangWatch panel and the selector in the terminal ask the
    # same question at the same time. The first answer wins. The CLI applies
    # its own answer at once and tells the platform with a permission_answered
    # frame; it never waits for the platform to relay its own answer back.

    @unit
    Scenario: The selector offers the session grant first
      Given a connected folder
      When Langy asks for permission to run a command
      Then the terminal draws a selector under the transcript
      And the first option allows the pattern for this session and is selected
      And the second option allows it this time only
      And the third option denies it and offers to tell Langy what to do instead

    @unit
    Scenario: A chain names every pattern the grant would cover
      Given a connected folder
      When Langy asks for permission to run a chain of commands
      Then the first option names every pattern the grant covers

    @unit
    Scenario: The session grant names the program and its first argument
      Given a connected folder
      When Langy asks to run a one-line program with the python interpreter
      Then the grant offered covers commands that start with the interpreter and the flag it ran
      And the same interpreter with another first argument asks again
      And a command written with no argument at all offers its own name

    @unit
    Scenario: The box says what the session grant covers
      Given a permission selector open in the terminal
      When the first option offers a session grant
      Then a dim line under the options reads what every command the grant covers starts with

    @unit
    Scenario: The selector says what the command is and what it changes
      Given a connected folder
      When Langy asks for permission to run a command with a time limit
      Then the box heading names the folder
      And the command is printed in full inside the box
      And the reason and the time limit are printed under it

    @unit
    Scenario: Allowing the pattern runs the call and settles the line
      Given a permission selector open in the terminal
      When I confirm the first option
      Then the call runs
      And the platform is told the terminal answered
      And the selector is replaced by one line naming the patterns it granted
      And the next matching command runs without asking

    @unit
    Scenario: Allowing once runs the call and grants nothing
      Given a permission selector open in the terminal
      When I choose the second option and confirm
      Then the call runs
      And the selector is replaced by one line reading that it was allowed once
      And the next matching command asks again

    @unit
    Scenario: A number answers at once
      Given a permission selector open in the terminal
      When I press 1, 2 or 3
      Then that option is answered at once, with no Enter after it
      And the arrow keys still move the highlight for Enter to confirm

    @unit
    Scenario: Denying reads one line of text and sends it back to Langy
      Given a permission selector open in the terminal
      When I choose the third option and type what Langy should do instead
      Then the call is refused with what I typed as the reason
      And the settled line reads the reason back

    @unit
    Scenario: Escape denies with no reason
      Given a permission selector open in the terminal
      When I press Escape
      Then the call is refused with no reason typed
      And Langy is told the developer denied it

    @unit
    Scenario: Transcript lines are held while the selector is open
      Given a permission selector open in the terminal
      When another call finishes while the question is on the screen
      Then its lines are printed only after the question is answered

    @unit
    Scenario: Two questions at once are asked one at a time
      Given two calls that both need an answer
      When the second one arrives while the first question is on the screen
      Then only one selector is drawn
      And the second question opens when the first one is answered

    @unit
    Scenario: The card can answer first and the settled line names it
      Given a permission selector open in the terminal
      When the card in the panel is answered first
      Then the selector is erased
      And the settled line says the answer came from the card in LangWatch
      And the card's decision is applied

    @unit
    Scenario: A card answer after the terminal answered is ignored
      Given a permission answered in the terminal
      When the platform sends the answer from the card for the same call
      Then the CLI does nothing with it
      And the call is not run twice

    @unit
    Scenario: Without a terminal there is no selector
      Given output that is piped rather than a terminal
      When Langy asks for permission to run a command
      Then no selector is drawn
      And the terminal prints the command and that the answer is given on the card in LangWatch

    @unit
    Scenario: A long command is printed once
      Given a connected folder
      When Langy asks for permission to run a long chain and I allow the pattern
      Then the ask prints the chain in full, wrapped at the width of the box
      And the answer prints as one short line naming the patterns that were granted

  Rule: The CLI decides what may run, and the command line is parsed

    # The permission rules themselves are in
    # specs/langy/langy-local-permissions.feature. These are the ways a
    # command can reach around them, and what the CLI does about each.

    @unit
    Scenario: An env option that can carry a program asks
      Given a connected folder
      When Langy runs a command through env
      Then only the forms that prepare the environment of a read-only command run
      And an option that can carry a program, a directory or a signal asks
      And a bare env asks, because the environment may hold secrets

    @unit
    Scenario: An allowed command with an operand that writes asks
      Given a connected folder
      When Langy runs a read-only command with an operand that writes
      Then the operand is judged as well as the command name
      And the command asks

    @unit
    Scenario: A shell command that reads a file which may hold secrets asks
      Given a connected folder
      When Langy reads a file that may hold secrets through a shell command
      Then it asks the same way a read of that file asks
      And a name with a wildcard that could stand for such a file asks too

    @unit
    Scenario: A command runs with the machine's own variables and no more
      Given a connected folder
      When Langy runs any command
      Then the command inherits the paths, the shell and the language of the machine
      And it does not inherit the keys the command line itself holds

  Rule: Exiting is clean

    @unit
    Scenario: Ctrl-C tells the platform and stops running commands
      Given a connected folder with a command in flight
      When I press Ctrl-C
      Then the CLI tells the platform it is leaving
      And kills the command and its child processes
      And exits within five seconds

    @unit
    Scenario: A disconnect from the panel stops the commands it started
      Given a connected folder with a command in flight and a question on the screen
      When the folder is disconnected from the panel
      Then the command and its child processes are killed
      And the question is closed with a line saying it was dropped
      And the CLI exits with code zero

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
