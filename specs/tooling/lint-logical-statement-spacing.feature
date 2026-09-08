Feature: The logical-statement-spacing lint rule
  A statement following a control-flow block, or a non-sole return/throw,
  needs one blank line before it — crowding the two together hides where one
  branch ends and the next statement begins. A statement that spans several
  lines is a paragraph of its own, and each procedure or route group in a
  builder chain starts after a blank line. The rule fixes every gap it finds.

  @unit
  Scenario: A multi-line statement stands as its own paragraph
    Given a function body where a statement spanning several lines touches the statement before or after it
    When the logical-statement-spacing rule runs over it
    Then it reports paragraphSpacing on each crowded side
    And a single-line declaration followed by its single-line guard is left together

  @unit
  Scenario: Groups in a builder chain are separated
    Given a multi-line call chain that opens a second procedure or route group with no blank line before it
    When the logical-statement-spacing rule runs over it
    Then it reports chainGroupSpacing on the second opener and not the first
    And a chain that fits on one line is left alone

  @unit
  Scenario: A statement crowding a control-flow block is reported and fixed
    Given a function whose return statement immediately follows an if block with no blank line
    When the logical-statement-spacing rule runs over it
    Then it reports statementSpacing

  @unit
  Scenario: A blank line after control flow satisfies the rule
    Given a function whose return statement follows an if block after a blank line
    When the logical-statement-spacing rule runs over it
    Then it reports nothing
