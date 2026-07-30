Feature: Following a Langy trace search through to the Trace Explorer

  When Langy answers "34 traces errored overnight", the user's next move is to go
  look at them. The trace card offers "View in Trace Explorer" for exactly that.

  That link has one job, and it is easy to get subtly wrong: it must land the user
  on THE SAME QUESTION the card just answered. A link that quietly asks a
  different question is worse than no link at all — the user reads the new numbers
  as a correction of the old ones, and neither of them is wrong, so there is
  nothing to notice.

  Background:
    Given I am working in a project
    And Langy has searched my traces and shown me a card of what it found

  Rule: The link lands on the same result set, from wherever I clicked it

    Scenario: Following the link while I am already looking at traces
      Given I am on the Trace Explorer with the panel open beside it
      When I follow "View in Trace Explorer" from the card
      Then the Explorer shows the traces Langy searched
      And it does not keep showing whatever I was looking at before

    Scenario: Following the link from somewhere else in the project
      Given I am on a page other than the Trace Explorer
      When I follow "View in Trace Explorer" from the card
      Then the Explorer shows the traces Langy searched

    Scenario: The link survives long enough to be read
      When I follow "View in Trace Explorer" from the card
      Then the address stays the one I followed
      And it is not replaced by the view I had open a moment earlier

  Rule: The link asks the question Langy asked, not a wider one

    Scenario: A search over a stated period keeps that period
      Given Langy searched a stated period
      When I follow "View in Trace Explorer" from the card
      Then the Explorer covers that same period

    Scenario: A search that stated no period keeps the period it actually covered
      Given Langy searched without naming a period
      When I follow "View in Trace Explorer" from the card
      Then the Explorer covers the period the search itself covered
      And it does not silently widen to the Explorer's usual default

    Scenario: A search narrowed to where the traces came from stays narrowed
      Given Langy searched only traces from a particular origin
      When I follow "View in Trace Explorer" from the card
      Then the Explorer shows only traces from that origin

    Scenario: A search narrowed to several origins keeps all of them
      Given Langy searched traces from more than one origin
      When I follow "View in Trace Explorer" from the card
      Then the Explorer shows traces from any of those origins
      And it shows no traces from an origin the search excluded

  Rule: What was a phrase to Langy stays a phrase in the Explorer

    Scenario: A search phrase that reads like a filter is still a phrase
      Given Langy searched for the phrase "status:error"
      When I follow "View in Trace Explorer" from the card
      Then the Explorer searches for that phrase
      And it does not reinterpret it as a filter on a field

  Rule: The card is honest about what the link can and cannot carry

    Scenario: The sample never pretends to be the whole result
      Given Langy found more traces than the card shows
      Then the card says how many it found and how many it is showing
      And following the link shows at least every trace the card listed
