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
    Scenario: A link dressed to slip past the host check is refused
      Given a file request whose action names another host with quoted credentials, one slash, backslashes, two leading slashes, or as host and path with a common ending
      And one whose action names any scheme but http or https before two slashes, whatever the host, or javascript, data, vbscript, file, mailto or ftp at a word's start
      And one whose allowed link is followed in the same word by a link to another host
      When the request is validated
      Then it is refused, and links to langwatch.ai are accepted
      And so are words that only look like a link: metadata:user_id, profile:enterprise, slack:x, trace.cost/day, cost.total/1000

    @unit
    Scenario: A named scheme is refused wherever a word can start, in any case and split by a tab
      Given a file request whose action names javascript, data, vbscript, file, mailto or ftp at a word's start, or right after a bracket or a quote
      And the same in mixed case, or with a tab inside the scheme
      When the request is validated
      Then each is refused

    @unit
    Scenario: Product words that only look like a scheme or a double slash are accepted
      Given a file request whose action says path:/api/v1/chat, span.name:/api/chat, C:/Users/x, trace.data:value, meta-data:x, span/data:x or input//output
      When the request is validated
      Then it is accepted

    @unit
    Scenario: A tab or a line break that could carry a link on to another host is refused
      Given a file request whose action's link is followed by a tab, or by a line break and then a dot, an at sign, a slash, a colon or a host name
      When the request is validated
      Then it is refused, and a link followed by a line break and an ordinary line is accepted

    @unit
    Scenario: Invisible format characters are dropped from an action
      Given a file request whose action holds a zero-width character inside a web address and a direction override
      When the request is validated
      Then they are gone, and the web address they hid is checked and refused

    @unit
    Scenario: Saving a card's finding drops an action a filing would refuse, and keeps the rest
      Given a finding of an answer's insights card with one action that links to another host and one that does not
      When the person saves it as an insight
      Then the filing carries only the second, and the log says how many were dropped and none of their words

    @unit
    Scenario: An answer saved from a conversation that cannot be read keeps no actions
      Given a member saves an answer with actions from a conversation they cannot read
      When the insight is filed
      Then it holds no actions

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
    Scenario: An oversize action is refused for its length, and its words are never checked
      Given a file request whose oversize action also names a link to another host
      When the request is validated
      Then the only issue is its length, since the check of its words never ran

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
    Scenario: A click waits until the fork reads as the clicker's, its history copied
      Given an insight saved from a conversation another person shared, whose fork lands a few reads later
      When its owner clicks an action
      Then Langy is sent nothing until the fork lands, and then continues the fork

    @unit
    Scenario: A fork that reads as the clicker's before its history landed is not continued yet
      Given a fork that reads as the clicker's while its copied messages have not all landed
      When its owner clicks an action
      Then Langy is sent nothing until the messages have landed, and then continues the fork

    @unit
    Scenario: A fork that never gets ready starts a new seeded conversation, and does not say the original is gone
      Given a fork that has not landed when the wait ends
      When its owner clicks an action
      Then Langy starts a new conversation that begins with the insight, and the fork is not continued
      And the answer says the fork was not ready, names the copy, and does not say the original is gone

    @unit
    Scenario: A fork that lands as the wait ends is still continued
      Given a fork that lands during the last pause of the wait
      When its owner clicks an action
      Then one last read finds it, and Langy continues the fork

    @unit
    Scenario: A fork that cannot be read counts as not ready
      Given a fork whose every read fails
      When its owner clicks an action
      Then Langy starts a new conversation once the wait ends
      And the answer says the fork was not ready, and does not say the original is gone
      And the log warns once for that wait, naming the fork and none of the prompt's words

    @unit
    Scenario: A click whose source conversation is gone starts a new seeded conversation
      Given an insight whose source conversation is archived or no longer visible
      When its owner clicks an action
      Then Langy starts a new conversation that begins with the insight's title, body, query and window
      And the answer says the original conversation is gone

    @unit
    Scenario: A click on an insight filed with no conversation does not say one is gone
      Given an insight filed with no source conversation
      When its owner clicks an action
      Then Langy starts a new conversation that begins with the insight
      And the answer does not say an original conversation is gone

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
    Scenario: While one action is on its way, every insight's actions wait
      Given two insights with actions in the inbox
      When its owner clicks an action on the first
      Then the second insight's actions are disabled and say another action is on its way
      And once the first click answers, they are enabled again

    @integration
    Scenario: A click opens the conversation in Langy, and says when the original is gone
      Given an insight whose source conversation is gone
      When its owner clicks an action
      Then Langy opens on the new conversation
      And they are told the original conversation is gone

    @integration
    Scenario: A click whose fork was not ready says a new conversation started, and names the copy
      Given an insight saved from a conversation another person shared, whose fork did not get ready in time
      When its owner clicks an action
      Then Langy opens on the new conversation
      And they are told the copy was not ready and may still appear under its name
      And they are not told the original conversation is gone

    @integration
    Scenario: A click that answers after the person left the page leaves them where they are, and says where the conversation is
      Given an action on its way
      When the person leaves the page, and then the click answers
      Then the address is left alone
      And they are told Langy has the action, and to find the conversation under Recent chats in the Langy panel

    @integration
    Scenario: A folder switched while a click is on its way is kept when the conversation opens
      Given an action on its way, and a folder switched since the click
      When the click answers and the conversation opens
      Then the address keeps the folder switched to, and names the conversation

    @integration
    Scenario: A click that answers while the inbox shows its load failure still opens the conversation
      Given an action on its way, and an inbox read that has failed
      When the click answers
      Then Langy opens on the conversation, and no toast says they left the page

    @integration
    Scenario: The actions keep waiting after a failed inbox read comes back
      Given an action on its way, and an inbox read that has failed
      When a later read brings the list back, before the click answers
      Then the actions are still disabled, and a click sends nothing

    @integration
    Scenario: A click that answers while the inbox shows its skeleton still opens the conversation
      Given an action on its way, and an inbox read that has to start over
      When the click answers while the skeleton shows
      Then Langy opens on the conversation, and no toast says they left the page

    @integration
    Scenario: The actions keep waiting after the skeleton gives way to the list
      Given an action on its way, and an inbox read that has to start over
      When the read brings the list back, before the click answers
      Then the actions are still disabled, and a click sends nothing

    @integration
    Scenario: A click that answers once no insight is left still opens the conversation
      Given an action on its way, and an inbox read that holds no insights any more
      When the click answers while the empty page shows
      Then Langy opens on the conversation, and no toast says they left the page

    @integration
    Scenario: The actions keep waiting when an insight lands on the empty page
      Given an action on its way, and an inbox read that holds no insights any more
      When a later read brings an insight back, before the click answers
      Then the actions are still disabled, and a click sends nothing

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
