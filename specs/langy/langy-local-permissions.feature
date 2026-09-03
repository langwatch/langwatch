Feature: The CLI decides what Langy may run on the developer's machine
  As a developer who shared my folder with Langy
  I want read-only work to run on its own and anything else to ask me first
  So that Langy is fast where it is safe and never surprises me where it is not

  # The CLI is the trust boundary. It holds the folder root, the read-only
  # allowlist, the grants I gave this session and the skip state. The chat
  # card is the way to get my answer; the server only relays it. The one
  # thing the server gates is the skip toggle, on the model that runs the
  # conversation (specs/settings/model-provider-skip-permissions.feature).
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
    Scenario: Editing a file inside the folder runs at once
      When Langy writes or edits a file inside the folder
      Then the change is applied at once
      And no permission card is rendered

    @unit
    Scenario: A compound command is judged by its strictest part
      When Langy runs a read-only command chained with one that is not
      Then the whole command asks for permission

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
    Scenario: Allowing once runs the command and returns its output
      Given a permission card for the type check
      When I allow it once
      Then the command runs
      And Langy receives the output in the same turn
      And the card reads allowed

    @integration
    Scenario: A session grant silences the next matching command
      Given I allowed the package manager pattern for this session
      When Langy runs another command with the same package manager
      Then the command runs without a card

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
      And the pattern the card offered covers the interpreter

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

    @integration
    Scenario: A grant lives with the session, not with the conversation
      Given I allowed a pattern for this session
      When the CLI exits and a new share starts for the same conversation
      Then the pattern asks again

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
    Scenario: Privilege escalation is refused
      When Langy runs a command with sudo, su or doas
      Then the command is refused
      And the pushback says the folder is shared without administrator rights

    @unit
    Scenario: A secret file asks even for a read
      When Langy reads an environment file, a private key or a credentials file inside the folder
      Then a permission card is rendered
      And the card says the file may hold secrets

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
