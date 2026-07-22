Feature: Composing a rule from natural language

  The user describes an outcome in their own words; the agent inspects the
  project, fills the blanks, and answers with a plan that states the whole
  rule in a few lines — including anything it must create along the way.
  Nothing exists until the user approves. The unit of interaction is the
  plan, not a form.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.

  Background:
    Given a user composing on the automations page

  Rule: An intent becomes a reviewable plan

    Scenario: A described intent produces a plan card
      When the user describes wanting a Slack ping when daily model cost passes a limit
      Then the agent answers with a plan stating what it will watch, what makes it fire, and where it notifies
      And the plan offers approve, edit details, and cancel

    Scenario: The plan derives the kind from the intent
      When the user asks for a weekly quality digest to a Slack channel
      Then the plan describes a scheduled digest
      And the user is never asked to pick a rule kind

    Scenario: Prerequisites are part of the plan, not homework
      Given the metric the intent needs has no saved graph in the project
      When the plan is presented
      Then it states that the missing graph will be created as part of setup

  Rule: Nothing is created before approval

    Scenario: Approving executes the whole plan
      Given a plan that includes creating a prerequisite graph
      When the user approves
      Then the prerequisite is created, then the rule
      And the new rule appears in the list

    Scenario: Cancelling leaves no trace
      Given a presented plan
      When the user cancels
      Then no rule and no prerequisite is created

    Scenario: A failing step surfaces as an explained error on the plan
      Given a plan whose execution fails on a step
      When the user approves
      Then the plan shows which step failed and why in actionable terms
      And nothing beyond the completed steps was created

  Rule: The plan is a conversation, not a contract

    Scenario: A correction updates the plan in place
      Given a plan that notifies a Slack channel
      When the user says to use email instead
      Then the plan updates to notify by email and awaits approval again

    Scenario: Edit details opens the full form pre-filled from the plan
      Given a presented plan
      When the user chooses edit details
      Then the detailed form opens pre-filled with the plan's choices
      And saving from the form creates the rule

  Rule: The agent works within the same rules as the user

    Scenario: The agent cannot exceed the user's permissions
      Given the user cannot manage automations in this project
      Then composing does not offer to create rules

    Scenario: An approved plan validates like any other creation
      Given a plan whose rule would be invalid
      When the user approves
      Then creation fails with the same validation behavior as the form
