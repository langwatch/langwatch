Feature: The terms agreement on the organization step

  The organization step asks the new user to agree to the terms of service
  and the privacy policy before Next is enabled. The box and the sentence
  next to it are one target: a click anywhere on them ticks or unticks the
  agreement once, and the two links open their documents without changing it.

  @integration
  Scenario: Clicking the terms sentence or its box ticks the agreement
    Given a new user on the organization step
    When they click the agreement sentence
    Then the agreement is ticked
    When they click the box
    Then the agreement is no longer ticked

  @integration
  Scenario: Opening the terms link leaves the agreement as it was
    Given a new user on the organization step
    When they open the terms of service link
    Then the agreement is still not ticked
