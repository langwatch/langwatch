Feature: The pass-through-class lint rule
  A forwarding class - one whose public methods almost all call the method of
  the same name on one collaborator - is a hop, not a layer: every reader pays
  an indirection and learns nothing. The rule names the class, how many of its
  methods forward and which collaborator they forward to.

  @unit
  Scenario: A class that only forwards to one collaborator is reported
    Given a service module whose class forwards all five public methods to the same collaborator
    When the pass-through-class rule runs over it
    Then it reports passThrough on the class's line
    And the message names the class, the count of forwarded methods and the receiver
    And the message tells the reader to hold the collaborator at the caller and delete the class

  @unit
  Scenario: A class that reshapes, guards or fans out is left alone
    Given a service module whose class converts its input on the way through
    When the pass-through-class rule runs over it
    Then it reports nothing

  @unit
  Scenario: The feature facade and the routed repositories are exempt
    Given the same forwarding class in app/example.app.ts and in repositories/routed/
    When the pass-through-class rule runs over them
    Then it reports nothing, because the layout requires both to forward

  @unit
  Scenario: Tests, declarations and generated code are not read at all
    Given the same forwarding class in a test file and in a generated directory
    When the pass-through-class rule runs over them
    Then it reports nothing
