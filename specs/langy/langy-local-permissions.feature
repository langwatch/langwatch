Feature: The CLI decides what Langy may run on the developer's machine
  As a developer who shared my folder with Langy
  I want read-only work to run on its own and anything else to ask me first
  So that Langy is fast where it is safe and never surprises me where it is not

  # The CLI is the trust boundary. It holds the folder root, the read-only
  # allowlist, the grants I gave this session and the skip state. The chat
  # card and the terminal are both ways to get my answer, and the first
  # answer wins; the server only relays it. The one thing the server gates
  # is the skip toggle, on the model that runs the conversation
  # (specs/settings/model-provider-skip-permissions.feature).
  #
  # The read-only set is fixed and decided by parsing the command, never by
  # the model. Every precedent that used a blocklist, or trusted the model's
  # own opinion of a command, was bypassed. See dev/docs/adr/129-langy-local-control.md.

  Background:
    Given my local folder is connected to a Langy conversation

  Rule: Read-only work and edits inside the folder run without asking

    @unit
    Scenario: Reading, listing and searching never ask
      When Langy reads a file, lists a directory, finds files or searches text inside the folder
      Then the call runs at once
      And no permission card is rendered

    @unit
    Scenario: A read-only shell command runs at once
      When Langy runs a command from the read-only set, such as a git status or a version check
      Then the command runs at once
      And no permission card is rendered

    @unit
    Scenario: Listing the git worktrees runs at once
      When Langy runs "git worktree list"
      Then the command runs at once
      And no permission card is rendered
      And every other git worktree verb still asks

    @unit
    Scenario: Editing a file inside the folder runs at once
      When Langy writes or edits a file inside the folder
      Then the change is applied at once
      And no permission card is rendered

    @unit
    Scenario: A compound command is judged by its strictest part
      When Langy runs a read-only command chained with one that is not
      Then the whole command asks for permission

    @unit
    Scenario: The GitHub CLI sign-in check runs at once
      When Langy asks the GitHub CLI whether it is signed in, or for its version
      Then the command runs at once
      And every other GitHub CLI command still asks

    @unit
    Scenario: A read-only command with a write flag or a redirect asks
      When Langy runs a find with an exec flag, or a listing redirected into a file
      Then the command asks for permission

    @unit
    Scenario: Only a bare command name can be read-only
      When Langy runs a read-only command by its path instead of its name
      Then the command asks for permission

  Rule: Anything else asks in the chat, and the answer resumes the same turn

    @integration
    Scenario: A command outside the read-only set renders a permission card
      When Langy runs the project's type check
      Then the tool waits
      And a permission card reads the machine, the folder and the exact command
      And the card offers allow once, allow this pattern for the session and deny
      And the terminal reads that Langy asked for permission in the panel

    @integration
    Scenario: The card shows the whole command, wrapped
      Given a permission card for a command chain longer than the card is wide
      Then the card shows every character of the command, wrapped onto more lines
      And no part of it is left off the side of the card

    @integration
    Scenario: The session grant button names every pattern the click covers
      Given a permission card for a chain that fetches and then checks out a branch
      Then the session grant button names the pattern of every part the answer covers
      And it never names only the first part of the chain

    @integration
    Scenario: A pattern grant names the pattern it covers on the settled card
      Given I allowed a pattern for the session
      Then the settled card names the pattern the grant covers
      And a card allowed once reads that I allowed the command once
      And a denied card reads that I denied the command
      And no settled card reads only that I answered it

    @integration
    Scenario: The card names the time limit the command runs under
      Given a permission card for a command that runs with a time limit
      Then the card says after how long the command is stopped

    @integration
    Scenario: Allowing once runs the command and returns its output
      Given a permission card for the type check
      When I allow it once
      Then the command runs
      And Langy receives the output in the same turn
      And the card reads allowed

    @unit
    Scenario: A progress display is read as its last line, not every redraw
      Given a command that redraws one line while it works
      When Langy receives its output
      Then only the last state of that line is kept
      And the result of the command is not cut to make room for the redraws

    @integration
    Scenario: A session grant silences the next matching command
      Given I allowed the package manager pattern for this session
      When Langy runs another command with the same package manager
      Then the command runs without a card

    @unit
    Scenario: A command chain is split into its segments
      When Langy runs a chain that stages, commits, pushes and opens a pull request
      Then one permission card asks about the whole chain
      And the card lists every segment of the chain with the pattern that segment would grant
      And a segment that is read-only is marked as such

    @unit
    Scenario: A pattern grant covers exactly the segments the card named
      Given I allowed the pattern of a chain that stages, commits and pushes
      When Langy runs another chain whose segments are all covered
      Then the chain runs without a card
      And a chain with one segment outside those patterns asks again

    @unit
    Scenario: The reason says what the command changes
      When a command asks for permission
      Then the reason is one sentence naming what it changes, such as writing files, changing the repository, reaching the network, installing packages or running the project's own checks
      And the reason does not quote the command back

    @unit
    Scenario: A grant follows the command name and its first argument
      Given I allowed a git push for this session
      When Langy runs a git push to another remote
      Then the command runs without a card
      And a git command with a different first argument still asks

    @unit
    Scenario: Interpreter aliases share one grant
      Given I allowed a python command for this session
      When Langy runs the same command written as python3
      Then the command runs without a card
      And both spellings of the interpreter spend the same grant
      And the pattern names the program and its first argument

    @integration
    Scenario: Denying returns a pushback Langy acts on
      Given a permission card for a command that removes files
      When I deny it
      Then the tool result reads that I denied the command
      And Langy does not run the command again in that turn

    @integration
    Scenario: A card left unanswered expires and Langy ends its turn in words
      Given a permission card no one answers
      When the wait passes its budget
      Then the tool result reads that no answer arrived
      And Langy ends the turn saying what it needs from me
      And the card reads expired

    @integration
    Scenario: A late answer to an expired card does nothing
      Given an expired permission card
      When I allow it after the turn ended
      Then no command runs
      And the card explains that the next message will ask again

    @integration
    Scenario: The answered card is recorded, so a reload shows the same outcome
      Given I answered a permission card
      When the conversation is reloaded
      Then the card renders locked with my answer marked

    @unit
    Scenario: My answer settles the card before the record catches up
      Given a permission card rendered from the durable record alone
      When I answer it
      Then the card reads answered at once
      And a replay of the live stream does not put it back to waiting

    @unit
    Scenario: A card that was already answered says which answer closed it
      When I answer a card that someone already answered
      Then the refusal says it was already answered, and with which answer
      And it does not say Langy stopped waiting

    @unit
    Scenario: Every card of the conversation is on screen again after a reload
      Given a finished conversation where I allowed, denied and let one expire
      When I reopen it
      Then each card is on screen with the answer it ended on
      And a pattern grant names the pattern it covered

    @unit
    Scenario: A card raised before this tab was watching still appears
      Given Langy raised a permission card on a turn this browser did not start
      When the panel opens on that conversation
      Then the card is on screen, waiting for my answer
      And answering it there releases the command the same way

    @integration
    Scenario: A grant lives with the session, not with the conversation
      Given I allowed a pattern for this session
      When the CLI exits and a new share starts for the same conversation
      Then the pattern asks again

  Rule: The card and the terminal both answer, and the first answer wins

    # The developer is already looking at the terminal when the ask arrives, so
    # asking them to reach for the browser costs them the flow they came for.
    # Both places answer the same ask, and the ask settles once.

    @integration
    Scenario: An answer given in the terminal settles the card
      Given a permission card for a command I answer in my terminal
      When the command line reports the answer
      Then the card stops asking and reads answered
      And the record says the answer came from the terminal

    @integration
    Scenario: The ask keeps the first answer it was given
      Given a permission card I answered in the panel
      When the terminal reports an answer for the same command afterwards
      Then the card keeps the answer I gave in the panel
      And the later answer changes nothing

    @integration
    Scenario: The settled card says the answer came from the terminal
      Given a card answered in the terminal with a session grant
      Then the card reads that it was answered in the terminal
      And it names the pattern the grant covers

    @unit
    Scenario: The answer place travels with the card to every tab
      Given a card answered in the terminal
      When another tab reads the conversation record
      Then that card also reads answered in the terminal
      And a card answered in the panel names no terminal

    @unit
    Scenario: The panel names the terminal while the ask is open there too
      Given a conversation with a connected local folder
      And a card waiting for an answer
      Then the waiting line reads that I can answer on the card above or in the terminal
      And the composer reads the same
      And a conversation with no shared folder reads only about the card

    @integration
    Scenario: The panel learns about a terminal answer at once
      Given a card waiting for an answer
      When the command line reports the answer the developer gave in the terminal
      Then the settled card reaches the live stream before the durable record is written

    @integration
    Scenario: A click on a card the terminal already answered answers nothing
      Given a card that the terminal answered while it was still on screen
      When I click one of its buttons
      Then the answer is refused
      And the card reads that it was answered in the terminal
      And no failure is shown on the card

  Rule: A card sits where it happened, and never after the answer

    # Every card of the conversation was drawn below the whole transcript, so a
    # finished run ended on a settled permission card: the panel scrolled to
    # the bottom and the last thing on screen was a command, with the answer
    # that closed the turn sitting above it and off screen.
    @integration
    Scenario: A finished turn ends on its answer, not on a card
      Given a turn that raised a permission card and then answered
      When the turn has settled
      Then the card is shown above the message that closed the turn
      And that answer is the last thing in the turn

    @integration
    Scenario: A card waiting for me stays at the live edge
      Given a turn that is still running with a card on screen
      Then the card is shown below the transcript, beside the working line

  Rule: Some things are refused in every mode, with a pushback the model can act on

    @unit
    Scenario: A path outside the folder is refused
      When Langy reads, edits or lists a path outside the folder, by a relative parent path, an absolute path, a home path or a symlink that resolves outside
      Then the call is refused
      And the pushback names the folder that is allowed

    @unit
    Scenario: A command that changes directory outside the folder is refused
      When Langy runs a command that changes into a directory outside the folder, or names one with a directory flag
      Then the command is refused
      And the pushback names the folder that is allowed

    @unit
    Scenario: A git or GitHub CLI word is not judged a path
      When Langy runs "git remote -v && git symbolic-ref --short HEAD"
      Then the subcommand, the option flags and the reference are read as the command's own words
      And the command is not refused for leaving the folder
      And a git argument that carries a path separator is still checked
      And the argument of a directory flag is still checked
      And every word after the end-of-options marker is still checked

    @unit
    Scenario: A quoted string a command prints is not judged a path
      When Langy prints a quoted string with printf or echo
      Then the quoted string is read as text and not as a path
      And the command is not refused for leaving the folder
      And a quoted path given to a command that reads files is still checked
      And the target of a redirect is still checked

    @unit
    Scenario: A refusal names the argument it judged a path
      When a command is refused for naming a path outside the folder
      Then the refusal names the argument it read as a path
      And it says where that argument points
      And it names the folder that is allowed

    @unit
    Scenario: Privilege escalation is refused
      When Langy runs a command with sudo, su or doas
      Then the command is refused
      And the pushback says the folder is shared without administrator rights

    @unit
    Scenario: A secret file asks even for a read
      When Langy reads an environment file, a private key or a credentials file inside the folder
      Then a permission card is rendered
      And the card says the file may hold secrets

    @unit
    Scenario: A committed example environment file is not a secret
      When Langy reads an environment file with an example, sample, template or dist suffix
      Then the read runs at once
      And no permission card is rendered

    @integration
    Scenario: Langy explains a refusal instead of retrying it
      When a local call is refused
      Then Langy tells me what it needed and why it could not
      And Langy does not retry the same path or command

  Rule: Skipping permission checks is one explicit choice, gated by the model

    @integration
    Scenario: The skip choice is offered on the permission card
      Given a permission card
      And the conversation runs on a model allowed to skip
      Then the card offers to skip all permission checks for this session
      And the offer says I accept the risk

    @integration
    Scenario: Skipping records my consent and stops the cards
      Given a permission card
      When I choose to skip all permission checks for this session
      Then the choice is recorded in the conversation
      And the terminal reads that permission checks are off for this session
      And later commands run without a card

    @unit
    Scenario: Skipping never lifts the folder boundary or the privilege rule
      Given permission checks are off for this session
      When Langy runs a command outside the folder or with sudo
      Then the command is still refused

    @integration
    Scenario: A model outside the allowed list cannot skip
      Given a permission card
      And the conversation runs on a model that is not allowed to skip
      Then the skip choice is disabled
      And its tooltip says the model is not allowed and points at the provider settings
      And a request to skip from outside the card is refused with the same reason

    @integration
    Scenario: Changing the model ends the skip
      Given permission checks are off for this session
      When the conversation switches to a model that is not allowed to skip
      Then the next command asks again
