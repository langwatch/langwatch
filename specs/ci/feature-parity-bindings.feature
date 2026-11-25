Feature: Scenario bindings are recognised wherever a JSDoc puts them
  The parity gate binds a scenario to the first test call that follows its
  `@scenario` annotation. Test authors write that annotation inside the JSDoc
  above the test, and the JSDoc often carries prose after it, or closes on a
  line of its own. A binding that only counts when the annotation is the last
  line of its comment reads as "unbound" for tests that plainly cover their
  scenario, and the gate then reports debt nobody owes.

  @unit
  Scenario: An annotation followed by more of its own JSDoc still binds the test below
    Given a test whose JSDoc reads "@scenario", then two lines of prose, then the closer on its own line
    When the parity gate checks what follows the annotation
    Then the it() call under the closer is the bound test

  @unit
  Scenario: An annotation on the closing line still binds
    Given a single-line "/** @scenario Title */" above an it() call
    When the parity gate checks what follows the annotation
    Then the it() call is the bound test

  @unit
  Scenario: Prose after the comment does not bind
    Given an annotation whose comment closes and is followed by a statement that is not a test call
    When the parity gate checks what follows the annotation
    Then nothing is bound
