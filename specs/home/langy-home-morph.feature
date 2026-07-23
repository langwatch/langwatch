@unit
Feature: Sending from the Langy home
  As a project member asking Langy something from my home page
  I want the box I typed in to become the assistant's own box
  So that starting a conversation reads as one continuous object moving,
  never as one input vanishing while another appears somewhere else

  Sending from the home page's lit block opens the Langy panel and starts the
  conversation. Between those two moments the composer travels from the block
  to the panel's floor, carrying a copy of the block's warm light that dies as
  the panel's own takes over. The moving copy is decoration: it is never the
  thing being typed into, so nothing about the caret or mid-word text entry
  depends on it.

  The panel has two homes, a dock along the right edge and a floating card in
  the corner, and the send has to land in whichever the reader uses.

  Background:
    Given the Langy home renders
    And I have typed a question into the block's composer

  @unimplemented
  Scenario: The typed question is never left unrendered
    # Tracked: the queued question and the panel's optimistic bubble are both
    # shipped (`askLangy` queues it; the panel renders it and consumes it once
    # the turn begins), but the "replaced in place, without flickering" half
    # lives in LangyPanel's render and no test drives that panel end to end.
    # Needs a panel render test, not another store assertion.
    When I send it
    Then my question appears in the conversation straight away
    And it stays visible even if the assistant is still finishing an earlier answer
    And it is replaced in place by the real message once the turn begins, without flickering

  Scenario: The composer travels to the docked panel
    Given I use the panel docked to the right edge
    When I send my question
    Then the page makes room for the dock without dimming
    And the composer travels down and right and seats on the panel's floor
    And it keeps its corners the whole way, so it reads as the same object
    And the panel's own composer takes over where it lands

  Scenario: The composer travels to the floating panel
    Given I use the panel as a floating card
    When I send my question
    Then the page stays where it is and is not dimmed
    And the composer travels into the corner and the card settles around it
    And the panel's own composer takes over where it lands

  Scenario: The block's light stays where it is
    When I send my question
    Then only a copy of the block's warm light travels with the composer
    And that copy fades out as the panel's own glow takes over
    And the block's moving canvas itself never moves

  Scenario: Nothing animates when I have asked for less motion
    Given I have asked the system for reduced motion
    When I send my question
    Then the panel is simply open, with my question already in it
    And nothing travels across the screen
    And I am told the question was sent

  Scenario: The block does not collapse when the composer leaves
    When I send my question
    Then the block keeps the composer's height
    And a quiet line offers to continue in Langy
    And the example asks step aside while a conversation is open

  Scenario: A slow answer is the panel's business, not the home page's
    Given the assistant takes a while to answer
    When the travel has finished
    Then the home page shows no error and no notice of its own
    And the panel shows that it is working

  Scenario: A failed first answer is handled where the conversation is
    Given the first answer fails
    Then the failure is shown in the conversation, with its own way to recover
    And the home page still offers to continue in Langy
    And my question is not lost

  Scenario: Continuing does not start a second conversation
    Given I have already asked something from the block
    When I choose to continue in Langy
    Then the panel takes focus on the conversation I already started
    And no new conversation is created
