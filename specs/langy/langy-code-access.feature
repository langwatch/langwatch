Feature: Langy asks how to reach the customer's code, once
  As a developer chatting with Langy about my own application
  I want Langy to offer to make the change itself, on my machine or through GitHub
  So that "instrument my traces" ends with a pull request and not with a page of instructions

  # Langy has two ways to change a customer's program: the organization
  # GitHub App (specs/langy/langy-github-prs.feature) and a folder the
  # developer shares from their machine (specs/langy/langy-local-control.feature).
  # This file covers the choice between them: when Langy asks, what it asks
  # with, what a remembered answer does, and when it never asks at all.
  #
  # The card is a choices card (ADR-060). Picking an option is the next user
  # message, so the turn ends on the question and the answer starts the next
  # turn. See dev/docs/adr/129-langy-local-control.md.

  Background:
    Given I am signed in with Langy enabled for a project
    And the Langy panel is open on a conversation

  Rule: Work that changes the customer's program asks for code access first

    @e2e
    Scenario: Instrumenting traces offers the two ways to reach the code
      Given a project with no traces yet
      When I ask Langy to instrument my traces with LangWatch
      Then Langy says it can make the change itself
      And Langy's reply ends with a code access card offering to share my local folder or to use GitHub
      And the turn settles with no in-flight work awaiting the answer

    @integration
    Scenario: The card explains each option in the customer's words
      When the code access card renders
      Then the local option says it runs the tools I already have on my machine
      And the GitHub option says it opens a pull request through the LangWatch GitHub App
      And the GitHub option shows whether the app is installed for my organization

    @integration
    Scenario: Choosing GitHub continues on the existing pull request path
      Given an open code access card
      When I choose to use GitHub
      Then my choice appears as my own message in the conversation
      And the next turn carries GitHub credentials the way a pull request turn does
      And no local folder is requested

    @integration
    Scenario: Choosing GitHub without the app installed shows the install card
      Given my organization has not installed the LangWatch GitHub App
      And an open code access card
      When I choose to use GitHub
      Then Langy renders the in-chat Install GitHub App card
      And no pull request is attempted

    @integration
    Scenario: Choosing the local folder turns the card into the waiting state
      Given an open code access card
      When I choose to share my local folder
      Then the card shows the one command to run in my folder, with a copy button
      And the card says it is waiting for my approval in the terminal
      And the card shows when the request expires

    @e2e
    Scenario: Langy does not ask twice in one conversation
      Given a conversation with my local folder connected
      When I ask Langy for a second change to the same application
      Then Langy makes the change through the connected folder
      And no code access card is rendered

  Rule: Platform-only work never asks for code access

    @e2e
    Scenario: Creating a scenario on the platform needs no code
      When I ask Langy to create a scenario for the refunds flow
      Then Langy creates the scenario on the platform
      And no code access card is rendered

    @unit
    Scenario: The skill names the work that needs code and the work that does not
      Given the code changes skill
      When its decision table is read
      Then instrumenting tracing, wiring the SDK, fixing the agent behind a failing scenario and adding a run parameter to a connected agent need code access
      And creating a scenario, an evaluation, a prompt version and reading traces do not

  Rule: A remembered choice skips the question and stays visible

    @integration
    Scenario: Remembering GitHub answers the next conversation without a card
      Given I chose GitHub with the remember option in an earlier conversation
      When Langy needs code access in a new conversation
      Then no code access card is rendered
      And a status card reads that Langy is using GitHub because I remembered it
      And the status card offers to change the choice

    @integration
    Scenario: Changing the remembered choice stops the turn and asks again
      Given a status card that reads Langy is using GitHub
      And a turn is in flight
      When I choose to change the choice
      Then the turn stops
      And the remembered choice is cleared
      And the next turn renders the code access card

    @integration
    Scenario: The remembered choice can be cleared from the integrations settings
      Given I remembered GitHub for code access
      When I open the integrations settings
      Then the GitHub section shows that Langy uses GitHub for code changes
      And clearing it makes the next code change ask again

    @unit
    Scenario: The local folder is never remembered
      Given an open code access card
      When I choose to share my local folder with the remember option
      Then no preference is stored, because a folder must be shared again each time
      And the card says so

  Rule: A shared folder belongs to one conversation

    @integration
    Scenario: A folder connected in another conversation does not count
      Given my local folder is connected to a different conversation
      When Langy needs code access in this conversation
      Then the code access card is rendered
      And approving the new request connects the folder to this conversation

    @integration
    Scenario: A disconnected folder is asked for again
      Given my local folder was connected to this conversation and the CLI exited
      When Langy needs code access again
      Then Langy says the folder is no longer connected
      And the code access card is rendered with a fresh request
