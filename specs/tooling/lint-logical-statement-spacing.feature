Feature: The logical-statement-spacing lint rule
  A statement following a control-flow block, or a non-sole return/throw,
  needs one blank line before it — crowding the two together hides where one
  branch ends and the next statement begins. The rule fixes the gap it finds.

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
