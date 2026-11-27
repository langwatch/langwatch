Feature: A standalone on/off setting reads as one bordered row
  As someone turning a setting on or off
  I want the setting to look the same in a dialog and on a page
  So that I recognise it wherever it is offered

  @integration
  Scenario: A toggle row names its setting and steps up its border when on
    Given a toggle row labelled "Only signed calls" with a hint and a switch
    When the setting is on
    Then the row shows its label, its hint and the switch, and marks itself on
