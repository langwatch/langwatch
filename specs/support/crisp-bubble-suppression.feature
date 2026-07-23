Feature: Crisp support bubble suppression
  As a LangWatch user
  I want the support chat bubble to stay hidden unless I deliberately open the chat
  So that it never pops up over the Langy launcher in the corner of the screen

  Background:
    Given the app can load the Crisp support chat

  @unit
  Scenario: The bubble is suppressed from the first paint
    When the Crisp bubble policy installs
    Then the page is marked as suppressing the bubble
    And a hide command is queued for the support chat

  @unit
  Scenario: Switching back to the browser tab re-hides the bubble
    Given the Crisp bubble policy is installed
    When the tab becomes visible again
    Then a hide command is pushed to the support chat again

  @unit
  Scenario: Returning to the page or refocusing the window re-hides the bubble
    Given the Crisp bubble policy is installed
    When the page is restored or the window regains focus
    Then a hide command is pushed to the support chat again

  @unit
  Scenario: Crisp finishing its own boot re-hides the bubble
    Given the Crisp bubble policy is installed
    When Crisp reports it is ready
    Then a hide command is pushed to the support chat again

  @unit
  Scenario: Crisp re-inserting its widget into the page re-hides the bubble
    Given the Crisp bubble policy is installed
    When the Crisp widget container appears in the page
    Then a hide command is pushed to the support chat again

  @unit
  Scenario: Deliberately opening the support chat lifts suppression
    Given the Crisp bubble policy is installed
    When the user opens the support chat from the sidebar
    Then the suppression mark is removed from the page
    And the support chat is asked to show and toggle open

  @unit
  Scenario: Opening the chat from any other entry point lifts suppression
    Given the Crisp bubble policy is installed
    When the chat box reports it was opened
    Then the suppression mark is removed from the page

  @unit
  Scenario: Closing the support chat restores suppression
    Given the support chat is open
    When the chat box is closed
    Then the suppression mark returns to the page
    And a hide command is pushed to the support chat

  @unit
  Scenario: Switching tabs while chatting keeps the conversation visible
    Given the support chat is open
    When the tab becomes visible again
    Then no hide command is pushed
    And the suppression mark stays off the page

  @unit
  Scenario: Every re-hide trigger stands down while the chat is deliberately open
    Given the support chat is open
    When the tab switches, the page restores, the window refocuses, Crisp reports ready and its widget re-inserts
    Then no hide command is pushed
    And the suppression mark stays off the page
    When the chat box is closed
    Then suppression resumes

  @unit
  Scenario: An operator reply is never hidden
    Given the Crisp bubble policy is installed
    When a support message arrives
    Then the suppression mark is removed from the page

  @unit
  Scenario: Installs without Crisp loaded still work at boot time
    Given Crisp has not booted yet
    When the Crisp bubble policy installs
    Then the hide command and event bindings wait in the queue Crisp drains at boot

  @unit
  Scenario: Builds without Crisp are unaffected
    Given Crisp is not loaded at all
    When suppression is re-asserted or the support chat is toggled
    Then nothing crashes
    And the page stays marked as suppressing the bubble
