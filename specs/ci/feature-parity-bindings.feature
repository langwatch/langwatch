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

  # Tolerance per scenario, not per file (dev/docs/plans/platform-architecture-blocks.md rule 9).
  # The frozen pairs live in packages/architecture-enforcer/src/tools/feature-parity-frozen.json.

  @unit
  Scenario: A new untagged scenario fails even in a file whose older ones are frozen
    Given a feature file whose untagged scenario "Old" is on the frozen list
    And a scenario "New" added to the same file with no binding tag
    When the parity gate compares the untagged scenarios with the frozen list
    Then "New" is reported as a fresh finding
    And "Old" is tolerated

  @unit
  Scenario: A frozen scenario that no longer breaks the rule must leave the list
    Given the frozen list names a scenario that has since been tagged, renamed or deleted
    When the parity gate compares the untagged scenarios with the frozen list
    Then the entry is reported as stale

  @unit
  Scenario: An annotation on a scenario with no binding tag fails, naming the scenario and the missing tag
    Given a test in a ".integration.test.ts" file annotated with the title of a scenario tagged only "@bdd"
    When the parity gate looks for annotations on untagged scenarios
    Then it reports the test, the scenario's file and line, and that the scenario is missing "@integration"

  @unit
  Scenario: An annotation on an @unimplemented scenario says to replace the tag
    Given a unit test annotated with the title of a scenario tagged "@unimplemented" alone
    When the parity gate looks for annotations on untagged scenarios
    Then it tells the author to replace @unimplemented with "@unit"

  @unit
  Scenario: An annotation on a tagged scenario is not reported
    Given a test annotated with the title of a scenario tagged "@unit"
    When the parity gate looks for annotations on untagged scenarios
    Then nothing is reported

  @unit
  Scenario: An @unimplemented scenario cites its issue by tag or by the comment directly above
    Given one @unimplemented scenario tagged "@issue:1234"
    And one whose comment line directly above its tags names "#1234"
    And one in a feature tagged "@issue:1234"
    And one whose issue comment is separated from its tags by a blank line
    When the parity gate reads the feature file
    Then the first three cite an issue and the last does not

  @unit
  Scenario: Every parity finding says what to do instead
    Given a fresh untagged scenario, a fresh @unimplemented scenario without an issue and a stale frozen entry
    When the parity gate formats its findings
    Then the untagged one is told to take a binding tag, take @unimplemented with an issue, or be deleted
    And the @unimplemented one is told to add an @issue:<number> tag or a #<number> comment
    And the stale entry is told to leave the frozen list
