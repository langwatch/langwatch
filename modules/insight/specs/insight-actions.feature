Feature: Action buttons on an insight
  Langy may propose up to four actions with an insight it writes in a chat: each a button
  label and the prompt a click sends back to Langy. The card shows each prompt before the
  click, and nothing is sent until the owner clicks. A click continues the Langy conversation
  the insight came from, so Langy keeps its context, and the turn always runs as the clicker,
  in a conversation of theirs. An insight from a run offers no actions.

  # ADR: modules/insight/adrs/005-insight-actions.md
  # The card the actions come from: modules/langy/specs/langy-insights-card.feature

  Background:
    Given the release_insights and release_insight_actions flags are on for the project

  Rule: An insight keeps the actions it was filed with

    @unit
    Scenario: A filing keeps up to four actions, each a label and a prompt
      Given a file request with four actions
      When the request is validated
      Then it is accepted with the four actions, their words trimmed

    @unit
    Scenario: A filing with more than four actions is refused
      Given a file request with five actions
      When the request is validated
      Then it is refused with a field error on the actions

    @unit
    Scenario: An action label past 40 characters or a prompt past 1,000 is refused
      Given a file request whose action has a 41-character label, or a 1,001-character prompt
      When the request is validated
      Then it is refused with a field error on that action

    @unit
    Scenario: An action that links anywhere but langwatch.ai is refused
      Given a file request whose action names a web address on another host
      When the request is validated
      Then it is refused, and an action that links to app.langwatch.ai is accepted

    @unit
    Scenario: Control characters are dropped from an action, line breaks in a prompt are kept
      Given a file request whose action holds control characters, line breaks and tabs
      When the request is validated
      Then the control characters are gone, and the prompt keeps its line breaks and tabs

    @unit
    Scenario: Saving a card's finding keeps the actions it proposes
      Given a finding of an answer's insights card that proposes actions
      When the person saves it as an insight
      Then the filing carries those actions, and an answer with no card carries none

    @unit
    Scenario: A filing names its actions by position
      Given a member saves a Langy answer with two actions
      When they read their inbox
      Then the insight holds the two actions, named a0 and a1

    @unit
    Scenario: An answer saved from a run's conversation keeps no actions
      Given a member saves an answer with actions from a conversation a run started
      When the insight is filed
      Then it holds no actions

    @unit
    Scenario: A run files no actions, whatever its findings propose
      Given Langy's answer on a daily run proposes actions with a finding
      When the run files the finding
      Then the insight holds no actions

    @unit
    Scenario: An insight filed before actions existed offers none
      Given a filed event stored before actions existed
      When the event is folded
      Then the insight holds no actions

    @unit
    Scenario: An insight stored before actions existed offers none
      Given an insight row written before the actions column existed
      When the row is read
      Then the insight holds no actions

    @unit
    Scenario: An insight's actions are stored with it and read back the same
      Given an insight folded with actions
      When its row is written and read
      Then the actions read back as they were folded

    @unit
    Scenario: A renewal that carries actions replaces them
      Given an insight with actions
      When a renewal that carries no actions is folded, and one stored before actions existed
      Then the first clears the actions, and the older one keeps them

  Rule: A click sends the stored action to Langy, as the clicker

    @unit
    Scenario: A click sends Langy the stored prompt after a fixed framing line
      Given an insight with an action
      When its owner clicks the action
      Then Langy is sent the framing line naming the insight, a blank line and the prompt as stored

    @unit
    Scenario: The owner's click continues the conversation the insight came from
      Given an insight saved from a conversation its owner started
      When its owner clicks an action
      Then Langy continues that conversation, and no fork is made

    @unit
    Scenario: A click on an insight saved from another person's conversation continues a fork
      Given an insight saved from a conversation another person shared
      When its owner clicks an action
      Then the conversation is forked for them, and Langy continues the fork

    @unit
    Scenario: A click whose source conversation is gone starts a new seeded conversation
      Given an insight whose source conversation is archived or no longer visible
      When its owner clicks an action
      Then Langy starts a new conversation that begins with the insight's title, body, query and window
      And the answer says the original conversation is gone

    @unit
    Scenario: The same click sent twice sends Langy one message
      Given an owner's click on an action
      When the same click reaches the module twice
      Then both carry the same idempotency key, and Langy takes one message

    @unit
    Scenario: An action id another insight holds is not found on this one
      Given two insights of one owner, each with its own actions
      When the owner runs an action id of the second on the first
      Then the request is refused with insight_action_not_found

    @unit
    Scenario: An insight in another project is not found
      Given an insight filed in another project
      When its owner runs one of its actions in this project
      Then the request is refused with insight_not_found

    @unit
    Scenario: An action on an insight a run filed is refused
      Given an insight a daily run filed
      When its owner runs an action on it
      Then the request is refused with insight_action_from_run, and Langy is sent nothing

    @unit
    Scenario: An action whose source conversation is a run's is refused
      Given an insight with actions whose source conversation a run started
      When its owner clicks an action
      Then the request is refused with insight_action_from_run, and Langy is sent nothing

    @unit
    Scenario: A click while release_insight_actions is off is refused
      Given the release_insight_actions flag is off for the project
      When an owner clicks an action
      Then the request is refused with insight_actions_not_enabled, and Langy is sent nothing

    @integration
    Scenario: A click without langy:create is refused before the handler runs
      Given a member with analytics:view and no langy:create
      When they run an action on their insight
      Then the request is refused as forbidden before the handler runs

  Rule: The card shows the actions and sends nothing until one is clicked

    @integration
    Scenario: The card shows each action's prompt before any click, and sends nothing on its own
      Given an insight with actions in the inbox
      When the page draws
      Then each action shows its label and its exact prompt
      And no action is sent

    @integration
    Scenario: One click sends the action once, however often it is clicked
      Given an insight with an action in the inbox
      When its owner clicks the action twice while the first click is on its way
      Then the action is sent once

    @integration
    Scenario: A click opens the conversation in Langy, and says when the original is gone
      Given an insight whose source conversation is gone
      When its owner clicks an action
      Then Langy opens on the new conversation
      And they are told the original conversation is gone

    @integration
    Scenario: No action shows while release_insight_actions is off
      Given the release_insight_actions flag is off
      When the page draws an insight with actions
      Then no action button shows

    @integration
    Scenario: No action shows on an insight a run filed
      Given an insight a daily run filed
      When the page draws it
      Then no action button shows

    @integration
    Scenario: Without langy:create the actions are disabled and say why
      Given a member without langy:create
      When the page draws an insight with actions
      Then the action buttons are disabled, and the card says they need permission to use Langy
