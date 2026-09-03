# The page a notification's footer link opens
#
# Implementation:
#   packages/features/automation/web/src/screens/unsubscribe/  (the screen)
#   apps/ui/src/features/automations/ui/sections/unsubscribe-routes.tsx (its key and the token read)
#   packages/features/automation/server/src/transport/api-trpc/email-suppression.api.ts (the two public procedures)
#
# Related specs:
#   specs/automations/spam-prevention.feature , why every trigger email carries one
#
# Motivation: ADR-031 makes the `?token=` the authorization — its HMAC binds it
# to one recipient — so this page has no sign-in and no permission guard. The
# person who opens it is often not a LangWatch user at all, has one thing they
# want, and gets exactly one visit: a link that reads as broken, or a button
# that silences more than it says, has no second chance.

Feature: The unsubscribe landing page

  Background:
    Given a notification email footer carries an unsubscribe link
    And the link's token names one recipient, one project, and at most one automation

  Rule: The page offers exactly the scopes the link promises

    @unit
    Scenario: The unsubscribe link offers both scopes it promises
      Given a link minted for one automation in a project
      When the recipient opens it
      Then they are offered to stop that notification
      And they are offered to stop every notification from that project
      And both offers name what they would silence

    @unit
    Scenario: A link with no notification offers only the project scope
      Given a link that names no particular automation
      When the recipient opens it
      Then only the project-wide offer is shown

  Rule: Each choice silences what it says and no more

    @unit
    Scenario: Stopping one notification does not silence the project
      Given a link minted for one automation in a project
      When the recipient chooses to stop that notification
      Then only that notification is unsubscribed
      And they are told which notification stopped

    @unit
    Scenario: Stopping the project silences every notification from it
      Given a link minted for one automation in a project
      When the recipient chooses to stop everything from the project
      Then the whole project is unsubscribed
      And they are told the project's notifications stopped

  Rule: A link that cannot be resolved is a dead end, and a slow one is not

    @unit
    Scenario: An invalid or expired unsubscribe link is a dead end
      Given a link whose token the server refuses, or an address carrying no token at all
      When the recipient opens it
      Then they are told the link is invalid or expired
      And nothing is offered to confirm
      And an address with no token asks the server nothing

    @unit
    Scenario: A recipient waits rather than being told the link is dead
      Given the server has not yet answered whether the token resolves
      When the recipient is looking at the page
      Then they see that it is still working
      And they are not told the link is invalid
