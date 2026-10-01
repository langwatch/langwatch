# Retired 2026-09-05: the lantern that hosted the morph was mounted by nothing on
# main (HomePage renders LangyHomeHero), so the travelling composer never reached
# a customer there. Only the geometry scenarios the branch implements remain.
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

  Scenario: The composer travels to the docked panel
    Given I use the panel docked to the right edge
    When I send my question
    Then the page makes room for the dock without dimming
    And the composer travels down and right and seats on the panel's floor
    And it keeps its corners the whole way, so it reads as the same object
    And the panel's own composer takes over where it lands

  Scenario: The block's light stays where it is
    When I send my question
    Then only a copy of the block's warm light travels with the composer
    And that copy fades out as the panel's own glow takes over
    And the block's moving canvas itself never moves
