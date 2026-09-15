Feature: The positional-parameter-list lint rule
  CLAUDE.md asks for named parameters via object destructuring on a multi-argument
  function (`fn({ a, b })`, not `fn(a, b)`) because a positional list past a few
  entries makes every call site a place to get the order wrong. The rule reports a
  function, method or interface signature once it takes more positional parameters
  than the configured maximum, naming it and the count so the fix is a mechanical
  regroup into one options object. A constructor keeps its positional shape — house
  dependency injection takes collaborators that way — and a function whose arity the
  callee dictates, such as a callback passed straight into a call, is left alone
  because the caller does not choose that shape.

  @unit
  Scenario: A function with four positional parameters is reported
    Given a governed production function declared with four positional parameters
    When the positional-parameter-list rule runs over it
    Then it reports tooManyPositionalParameters naming the function and its count

  @unit
  Scenario: Three parameters are left alone
    Given a governed production function declared with three positional parameters
    When the positional-parameter-list rule runs over it
    Then it reports nothing

  @unit
  Scenario: A constructor is left alone
    Given a class whose constructor takes four positional parameters
    When the positional-parameter-list rule runs over it
    Then it reports nothing

  @unit
  Scenario: A callback's arity is left alone
    Given a four-parameter arrow function passed as a call argument
    When the positional-parameter-list rule runs over it
    Then it reports nothing
