Feature: The layer-class lint rule
  A class whose public methods almost all forward, under the same name, to the same
  collaborator is a hop, not a layer: every reader pays an indirection and learns
  nothing. The rule names the class, how many of its methods forward and which
  collaborator they forward to, so the reader can decide without opening the file.

  Background:
    Given a workspace whose project feature is at strict layout version 0

  @unit
  Scenario: A class that only forwards to one collaborator is reported as a layer
    Given a service module whose class forwards all five public methods to the same collaborator
    When the layer-class rule runs over it
    Then it reports deleteTheLayer
    And the message names the class, the count of forwarded methods and the receiver
    And the message tells the reader to hold the collaborator at the caller and delete the class

  @unit
  Scenario: A class that reshapes, guards or fans out is left alone
    Given a service module whose class converts its input on the way through
    When the layer-class rule runs over it
    Then it reports nothing

  @unit
  Scenario: The feature facade and the routed repositories are exempt
    Given the same forwarding class in app/example.app.ts and in repositories/routed/
    When the layer-class rule runs over them
    Then it reports nothing, because the layout requires both to forward

  @unit
  Scenario: Tests, declarations and generated code are not read at all
    Given the same forwarding class in a test file and in a generated directory
    When the layer-class rule runs over them
    Then it reports nothing
