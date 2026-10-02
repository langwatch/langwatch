Feature: Langy notifies the person when it needs them or has finished
  As a person whose project Langy is setting up
  I want Langy to tell me through a browser notification when it is done or needs me
  So that I can leave the tab while it works and come back at the right moment

  # The first browser notifications in LangWatch. The pieces, each reusable:
  # the browser capability (permission state, asking, a Web Push subscription
  # and the service worker that shows a push), a per-person choice stored on
  # the account (user.getNotificationPreference / user.setNotificationPreference,
  # keyed by topic, "langy" first), notification's Web Push (subscriptions,
  # VAPID keys, sending), and Langy's own rules for when to send one.
  #
  # The server sends; the tab is never the sender. Langy reacts to its own
  # events and asks notification for a push, so a closed tab, a sleeping laptop
  # or a network blip loses nothing. The open tab notifies only as a fallback,
  # on a device that cannot hold a push subscription (no Push API, or
  # subscribing failed). A device holding a subscription never notifies from
  # the tab, even when a push to it fails, so nothing arrives twice: not push
  # plus tab, not two tabs, not two devices, not a redelivered event. Nothing
  # is shown while a visible tab already shows that conversation, and nothing
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

  Rule: Langy's notifications leave from the server through Web Push

    @unit
    Scenario: A long turn finishing reaches the person through Web Push
      Given Langy notifications are enabled for the conversation's owner
      When a turn that ran for more than a minute completes
      Then Langy asks notification for one push to the owner saying Langy finished
      And the push links to the conversation and carries the conversation's tag

    @unit
    Scenario: A short turn sends nothing
      Given Langy notifications are enabled for the conversation's owner
      When a turn that ran for twenty seconds completes
      Then no push is asked for

    @unit
    Scenario: A card waiting on the person reaches them through Web Push
      Given Langy notifications are enabled for the conversation's owner
      When Langy puts up a card that waits for an answer
      Then a push says Langy needs a decision

    @unit
    Scenario: Langy's notify tool reaches the person through Web Push
      Given Langy notifications are enabled for the conversation's owner
      When Langy calls the notify tool with a title and a body
      Then a push carries that title and body

    @unit
    Scenario: A redelivered Langy event asks for the same push
      Given Langy notifications are enabled for the conversation's owner
      When the same finished-turn event is delivered twice
      Then both requests carry one idempotency key, so notification queues the push once per device

    @unit
    Scenario: Nothing is pushed to a person who did not turn notifications on
      Given the conversation's owner declined Langy notifications, or never answered
      When Langy puts up a card that waits for an answer
      Then no push is asked for

  Rule: Enabling notifications subscribes this browser to Web Push

    @integration
    Scenario: Enabling subscribes this browser
      Given the browser supports Web Push
      When I enable Langy notifications and the browser allows them
      Then this browser subscribes with the installation's VAPID public key
      And the subscription is stored for me on the server

    @integration
    Scenario: Turning notifications off unsubscribes this browser
      Given Langy notifications are enabled and this browser is subscribed
      When I turn Langy notifications off from the menu
      Then this browser's subscription is removed on the server and in the browser
      And my choice reads declined

    @integration
    Scenario: A browser already enabled subscribes again when it opens
      Given Langy notifications are enabled and the browser allows them
      And this browser holds no push subscription
      When I open LangWatch
      Then this browser subscribes and the subscription is stored for me

  Rule: The service worker shows a push unless a visible tab already shows it

    @unit
    Scenario: A push for a conversation no visible tab shows is shown
      Given no visible LangWatch tab shows the conversation
      When a push arrives for it
      Then the service worker shows a notification with its title, body and tag

    @unit
    Scenario: A push for a conversation a visible tab shows is skipped
      Given a visible LangWatch tab shows the conversation
      When a push arrives for it
      Then no notification is shown

    @unit
    Scenario: A push with two LangWatch tabs open shows once
      Given this browser holds a push subscription and two LangWatch tabs are open
      When a push arrives for a conversation neither tab shows
      Then the service worker shows one notification
      And neither tab shows one of its own

    @unit
    Scenario: Clicking a push focuses a LangWatch tab and opens the conversation
      Given a Langy notification was shown for a conversation
      When I click it
      Then an open LangWatch tab takes focus and opens that conversation
      And with no tab open, a new one opens at the conversation's link

  Rule: The open tab notifies only where this device cannot hold a push subscription

    @unit
    Scenario: A device with a live push subscription leaves notifying to the server
      Given Langy notifications are enabled and this browser is subscribed to Web Push
      And the tab is hidden
      When a long turn finishes
      Then the tab shows no notification of its own

    @unit
    Scenario: A browser not yet checked for push leaves notifying to the server
      Given Langy notifications are enabled
      And this browser's push subscription has not been checked yet
      When a long turn finishes
      Then the tab shows no notification of its own

    @integration
    Scenario: A failed push or a failed save never makes the tab notify
      Given this browser holds a push subscription
      And storing it on the server failed on the way
      When a long turn finishes while the tab is hidden
      Then this browser still counts as subscribed
      And the tab shows no notification of its own

    @integration
    Scenario: A browser without push support notifies from the tab
      Given Langy notifications are enabled and the browser allows them
      And the browser has no Push API
      When I open LangWatch
      Then the tab is the one that notifies on this device

    @integration
    Scenario: A browser whose subscribing failed notifies from the tab
      Given Langy notifications are enabled and the browser allows them
      And subscribing failed in the browser, or the server refused its push service
      When I open LangWatch
      Then the tab is the one that notifies on this device

    @integration
    Scenario: Two open tabs show one notification
      Given two hidden LangWatch tabs on a browser that cannot hold a push subscription
      When Langy puts up a card that waits for my answer
      Then both tabs tag their notification with the conversation
      And the browser keeps one on screen

    @unit
    Scenario: A long turn that finishes while I am away notifies me from the tab without push
      Given Langy notifications are enabled and the browser allows them
      And this browser cannot hold a push subscription
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

  Rule: The panel follows a turn through read hints, not a poll

    @unit
    Scenario: The conversation read refreshes on the turn's durable steps
      Given the panel shows a conversation
      Then its messages read is invalidated by a turn being accepted, a card starting or ending to wait, a hand-off, and the turn's answer or failure
      And it sets no polling interval

  Rule: Langy can notify on purpose, within a limit

    @integration
    Scenario: The notify tool shows its title and body when I am away
      Given Langy notifications are enabled and the browser allows them
      And this browser cannot hold a push subscription
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
