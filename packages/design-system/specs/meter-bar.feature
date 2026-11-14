Feature: A meter shows one reading, or a few parts of one whole, against its track
  As a reader comparing a value against the width it is measured in
  I want the meter to show each part of the whole in its own colour
  So that a split such as "every" and "some" reads at a glance

  @integration
  Scenario: A two-part meter lays its parts end to end in their own colours
    Given a meter split into a half and a quarter
    When it renders
    Then the half is drawn first and the quarter after it, each in its own colour token

  @integration
  Scenario: A two-part meter never runs past the end of its track
    Given a meter whose parts add up to more than the whole track
    When it renders
    Then the parts together fill the track exactly and a part that does not fit is not drawn
