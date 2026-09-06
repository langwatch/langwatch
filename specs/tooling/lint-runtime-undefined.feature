Feature: The runtime-undefined lint rule
  The ambient `undefined` value is shadowable at runtime; `void 0` never is.
  The rule reports a value-position read of `undefined` and fixes it to
  `void 0`, while leaving a binding, a type position, or an identifier
  position (a property key, an import name) alone. It is defined and tested
  like every other rule but is not wired into the enabled rule set.

  @unit
  Scenario: The ambient undefined value is reported and fixed to void 0
    Given a module that reads the ambient undefined value
    When the runtime-undefined rule runs over it
    Then it reports runtimeUndefined
    And the fix replaces it with void 0

  @unit
  Scenario: A shadowed undefined binding is left alone
    Given a function whose parameter is itself named undefined
    When the runtime-undefined rule runs over it
    Then it reports nothing

  @unit
  Scenario: undefined used as an identifier position is left alone
    Given a module where undefined names an object property key
    When the runtime-undefined rule runs over it
    Then it reports nothing
