Feature: Langy notifies the person when it needs them or has finished
  As a person whose project Langy is setting up
  I want Langy to tell me through a browser notification when it is done or needs me
  So that I can leave the tab while it works and come back at the right moment

  # The first browser notifications in LangWatch. Three pieces, each reusable:
  # the browser capability (permission state, asking, showing a notification
  # whose click focuses the tab), a per-person choice stored on the account
  # (user.getNotificationPreference / user.setNotificationPreference, keyed by
  # topic, "langy" first), and Langy's own rules for when to send one.
  #
  # Nothing is ever sent while the tab is visible and focused, and nothing
  # when the person has not turned Langy notifications on.

  Background:
    Given I am signed in with Langy enabled for a project

  Rule: The guided setup offers notifications once, after the folder is shared

    @integration
    Scenario: The offer appears after the folder is shared
      Given the guided setup is on the llmops path
      And Langy called the offer_notifications tool after my folder connected
      And I have not chosen about Langy notifications yet
      When the message renders
      Then a card says "It should now take around 10 minutes for me to fully set your project up. Can I notify you once it's done?"
      And it offers "Enable notifications" and "No thanks, I'll check back"

    @integration
    Scenario: The offer stays where Langy made it while the work goes on below it
      Given Langy called the offer_notifications tool and then kept working in the same turn
      When the message renders
      Then the offer card sits right after the call, before the reply that closes the turn

    @integration
    Scenario: Enabling asks the browser and turns Langy notifications on
      Given the notifications offer card is showing
      When I click "Enable notifications"
      And the browser grants permission
      Then my choice is stored as enabled on my account
      And the card settles on a line saying I will be notified

    @integration
    Scenario: Declining records the choice and settles the card
      Given the notifications offer card is showing
      When I click "No thanks, I'll check back"
      Then my choice is stored as declined on my account
      And the browser is never asked for permission
      And the card settles on a line saying no notification will be sent

    @integration
    Scenario: A card whose question was already answered shows the answer
      Given I already turned Langy notifications on
      When the notifications offer card renders, after a reload
      Then it shows no buttons
      And it says that notifications are on

    @unit
    Scenario: Langy offers notifications only once per conversation
      Given the worker already offered notifications in this conversation
      When the model calls offer_notifications again
      Then the call is refused with a line telling it the offer was already made

  Rule: The choice lives on the account

    @unit
    Scenario: A person who never chose reads no choice
      Given a person who never answered the notifications offer
      When their Langy notification choice is read
      Then it is empty

    @unit
    Scenario: A stored choice is read back and can be changed
      Given a person who enabled Langy notifications
      When they turn Langy notifications off
      Then their Langy notification choice reads declined

  Rule: Langy's menu turns notifications on and off

    @integration
    Scenario: The menu toggles Langy notifications
      Given the browser allows notifications
      And Langy notifications are off
      When I open Langy's menu and choose "Notifications"
      Then my choice is stored as enabled on my account
      And the Notifications item shows a check

    @integration
    Scenario: The menu says when the browser blocked notifications
      Given the browser blocked notifications for this site
      When I open Langy's menu
      Then the Notifications item says the browser blocked them
      And a short line says how to allow them again from the address bar

  Rule: Langy sends a notification only when the person is away and asked for them

    @unit
    Scenario: A long turn that finishes while I am away notifies me
      Given Langy notifications are enabled and the browser allows them
      And the tab is hidden
      When a turn that ran for more than a minute finishes
      Then a notification says Langy finished

    @unit
    Scenario: A short turn that finishes while I am away sends nothing
      Given Langy notifications are enabled and the browser allows them
      And the tab is hidden
      When a turn that ran for ten seconds finishes
      Then no notification is sent

    @unit
    Scenario: A decision Langy needs while I am away notifies me
      Given Langy notifications are enabled and the browser allows them
      And the tab is not focused
      When Langy puts up a card that waits for my answer
      Then a notification says Langy needs a decision

    @unit
    Scenario: A card already waiting when I reopen a conversation sends nothing
      Given a conversation with a card that was already waiting for my answer
      When I reopen it and its record loads after its folder state
      Then the waiting card is part of what the tab already knew
      And no notification is sent

    @integration
    Scenario: A card that comes up while the tab is hidden still reaches it
      Given a turn is in flight and the tab is hidden
      When Langy puts up a card that waits for my answer
      Then the tab keeps reading the conversation and sees the card

    @unit
    Scenario: Nothing is sent while the tab is focused and visible
      Given Langy notifications are enabled and the browser allows them
      And the tab is visible and focused
      When a long turn finishes
      Then no notification is sent

    @unit
    Scenario: Nothing is sent when Langy notifications are not on
      Given I declined Langy notifications
      And the tab is hidden
      When a long turn finishes
      Then no notification is sent

    @integration
    Scenario: Clicking a notification focuses the tab and opens the conversation
      Given a Langy notification was shown for a conversation
      When I click it
      Then the tab takes focus
      And the Langy panel opens that conversation

  Rule: Langy can notify on purpose, within a limit

    @integration
    Scenario: The notify tool shows its title and body when I am away
      Given Langy notifications are enabled and the browser allows them
      And the tab is hidden
      When Langy calls the notify tool with the title "Your project is ready" and a body
      Then a notification shows that title and body

    @unit
    Scenario: The notify tool refuses a second call within a minute
      Given Langy sent a notification less than a minute ago
      When the model calls notify again
      Then the call is refused and says when it may notify next

    @unit
    Scenario: The notify tool refuses past its hourly budget
      Given Langy sent five notifications in the last hour
      When the model calls notify again
      Then the call is refused
